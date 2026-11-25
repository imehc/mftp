use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::time::Instant;

use rusqlite::{Connection, OptionalExtension};
use serde_json::Value;

use super::database::{self, MAX_RECORD_BYTES, MAX_ROWS};
use super::images::NativeImage;
use super::model::{AgentSessionMessage, SessionRole};
use super::{
    text,
    transcript::{self, Transcript},
};
use crate::error::{AppError, AppResult, CustomErrorCode};

fn attachments<'a>(payload: &'a Value) -> Vec<NativeImage<'a>> {
    let mut result = Vec::new();
    let Some(items) = payload["attachments"].as_array() else {
        return result;
    };
    for item in items.iter().take(20) {
        if item["kind"] != "image"
            && !item["mimeType"]
                .as_str()
                .is_some_and(|mime| mime.starts_with("image/"))
        {
            continue;
        }
        let name = item["name"].as_str().unwrap_or("image").to_owned();
        if let Some((prefix, data)) = item["previewDataUrl"]
            .as_str()
            .and_then(|url| url.split_once(','))
        {
            if prefix.starts_with("data:image/") && prefix.ends_with(";base64") {
                result.push(NativeImage::Inline { data, name });
                continue;
            }
        }
        if let Some(path) = item["path"].as_str().filter(|path| !path.is_empty()) {
            let path = url::Url::parse(path)
                .ok()
                .and_then(|url| url.to_file_path().ok())
                .unwrap_or_else(|| PathBuf::from(path));
            result.push(NativeImage::File { path, name });
        }
    }
    result
}

fn model(value: &Value, result: &mut Transcript, cancel: &AtomicBool) -> AppResult<Option<String>> {
    if let Some(raw) = value.as_str() {
        if raw.trim_start().starts_with('{') {
            let object = database::json(Some(raw.to_owned()), result, cancel)?;
            return Ok(object.as_ref().and_then(|object| {
                database::string(&object["id"]).or_else(|| database::string(&object["model"]))
            }));
        }
        return Ok(database::string(value));
    }
    Ok(database::string(&value["id"]).or_else(|| database::string(&value["model"])))
}

pub(super) fn visit(
    connection: &Connection,
    id: &str,
    cancel: &AtomicBool,
    callback: &mut impl FnMut(AgentSessionMessage, &[NativeImage<'_>]) -> AppResult<()>,
) -> AppResult<Transcript> {
    let start = Instant::now();
    let metadata = connection.query_row("SELECT CASE WHEN length(CAST(title AS BLOB))<=?2 THEN title END,CASE WHEN length(CAST(cwd AS BLOB))<=?2 THEN cwd END,CASE WHEN length(CAST(model AS BLOB))<=?2 THEN model END,created_at,updated_at,archived FROM chat_sessions WHERE session_id=?1 AND (deleted_at IS NULL OR deleted_at=0 OR deleted_at='')", rusqlite::params![id, MAX_RECORD_BYTES as i64], |row| {
        Ok((database::scalar(row, 0)?, database::scalar(row, 1)?, database::scalar(row, 2)?, database::scalar(row, 3)?, database::scalar(row, 4)?, database::scalar(row, 5)?))
    }).optional()?.ok_or_else(|| AppError::custom(CustomErrorCode::AgentSessionMissing))?;
    let mut result = Transcript {
        id: Some(id.to_owned()),
        title: text::safe_preview(metadata.0.as_str().unwrap_or_default()),
        cwd: metadata.1.as_str().unwrap_or_default().into(),
        created: database::timestamp(&metadata.3),
        updated: database::timestamp(&metadata.4),
        archived: metadata.5 == true || metadata.5.as_i64() == Some(1),
        ..Transcript::default()
    };
    result.model = model(&metadata.2, &mut result, cancel)?;
    let mut statement = connection.prepare("SELECT CASE WHEN length(CAST(role AS BLOB))<=32 THEN role END,CASE WHEN length(CAST(payload_json AS BLOB))<=?2 THEN payload_json END,created_at FROM chat_session_messages WHERE session_id=?1 ORDER BY sequence,message_id LIMIT 200001")?;
    let mut rows = statement.query(rusqlite::params![id, MAX_RECORD_BYTES as i64])?;
    let mut records = 0;
    while let Some(row) = rows.next()? {
        database::check(cancel, start)?;
        records += 1;
        if records > MAX_ROWS {
            result.complete = false;
            break;
        }
        let raw_role: Option<String> = row.get(0)?;
        let Some(raw_role) = raw_role else {
            result.complete = false;
            continue;
        };
        let role = match raw_role.as_str() {
            "user" => SessionRole::User,
            "assistant" => SessionRole::Assistant,
            "system" => SessionRole::System,
            _ => {
                result.complete = false;
                continue;
            }
        };
        let ts = database::timestamp(&database::scalar(row, 2)?);
        let Some(payload) = database::json(row.get(1)?, &mut result, cancel)? else {
            continue;
        };
        let Some(parts) = payload["parts"].as_array() else {
            result.complete = false;
            continue;
        };
        let native = attachments(&payload);
        let before_count = result.count;
        let before_total = result.total;
        let mut attached = false;
        for part in parts {
            let (part_role, raw) = match part["type"].as_str() {
                Some("text") => (role, text::content(&part["text"])),
                Some("thinking") => (SessionRole::Thinking, text::content(&part["text"])),
                Some("tool") => {
                    let tool = &part["tool"];
                    (
                        SessionRole::Tool,
                        format!(
                            "{}\n{}\n{}\n{}",
                            tool["name"].as_str().unwrap_or_default(),
                            database::rendered(&tool["input"]),
                            database::rendered(&tool["response"]),
                            database::rendered(&tool["shellOutput"])
                        ),
                    )
                }
                Some("hook") => (SessionRole::System, database::rendered(&part["hook"])),
                Some("contextCompression") => (SessionRole::System, database::rendered(part)),
                Some("image" | "file") => continue,
                _ => {
                    result.complete = false;
                    continue;
                }
            };
            let images = if !attached && part_role == role {
                native.as_slice()
            } else {
                &[]
            };
            if part_role == role {
                attached = true;
            }
            transcript::emit(
                &mut result,
                transcript::message(part_role, raw, ts),
                images,
                cancel,
                callback,
            )?;
        }
        if !attached && !native.is_empty() {
            transcript::emit(
                &mut result,
                transcript::message(role, String::new(), ts),
                &native,
                cancel,
                callback,
            )?;
        }
        result.count = before_count.saturating_add(u32::from(
            (role == SessionRole::User && result.count > before_count)
                || (role == SessionRole::Assistant && result.total > before_total),
        ));
    }
    result.created = database::timestamp(&metadata.3).or(result.created);
    result.updated = database::timestamp(&metadata.4).or(result.updated);
    if result.title.is_empty() {
        result.title = result.preview.clone();
    }
    Ok(result)
}
