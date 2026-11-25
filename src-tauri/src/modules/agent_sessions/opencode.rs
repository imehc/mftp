use std::sync::atomic::AtomicBool;
use std::time::Instant;

use rusqlite::{Connection, OptionalExtension};

use super::database::{self, MAX_RECORD_BYTES, MAX_ROWS};
use super::images::{self, NativeImage};
use super::model::{AgentSessionMessage, SessionRole};
use super::{
    text,
    transcript::{self, Transcript},
};
use crate::error::{AppError, AppResult, CustomErrorCode};

pub(super) fn visit(
    connection: &Connection,
    id: &str,
    cancel: &AtomicBool,
    callback: &mut impl FnMut(AgentSessionMessage, &[NativeImage<'_>]) -> AppResult<()>,
) -> AppResult<Transcript> {
    let start = Instant::now();
    let metadata = connection.query_row("SELECT CASE WHEN length(CAST(title AS BLOB))<=?2 THEN title END,CASE WHEN length(CAST(directory AS BLOB))<=?2 THEN directory END,CASE WHEN length(CAST(model AS BLOB))<=?2 THEN model END,time_created,time_updated,time_archived FROM session_v2 WHERE id=?1", rusqlite::params![id, MAX_RECORD_BYTES as i64], |row| {
        Ok((database::scalar(row, 0)?, database::scalar(row, 1)?, database::scalar(row, 2)?, database::scalar(row, 3)?, database::scalar(row, 4)?, database::scalar(row, 5)?))
    }).optional()?.ok_or_else(|| AppError::custom(CustomErrorCode::AgentSessionMissing))?;
    let mut result = Transcript {
        id: Some(id.to_owned()),
        title: text::safe_preview(metadata.0.as_str().unwrap_or_default()),
        cwd: metadata.1.as_str().unwrap_or_default().into(),
        created: text::timestamp(&metadata.3),
        updated: text::timestamp(&metadata.4),
        archived: metadata.5.as_f64().is_some_and(|value| value > 0.0),
        ..Transcript::default()
    };
    let model = if let Some(raw) = metadata.2.as_str().filter(|raw| !raw.trim().is_empty()) {
        database::json(Some(raw.to_owned()), &mut result, cancel)?
    } else {
        None
    };
    result.model = model
        .as_ref()
        .and_then(|model| database::string(&model["id"]));
    let mut statement = connection.prepare("SELECT CASE WHEN length(CAST(type AS BLOB))<=128 THEN type END,CASE WHEN length(CAST(data AS BLOB))<=?2 THEN data END,time_created FROM session_message WHERE session_id=?1 ORDER BY seq,id LIMIT 200001")?;
    let mut rows = statement.query(rusqlite::params![id, MAX_RECORD_BYTES as i64])?;
    let mut records = 0;
    while let Some(row) = rows.next()? {
        database::check(cancel, start)?;
        records += 1;
        if records > MAX_ROWS {
            result.complete = false;
            break;
        }
        let kind: Option<String> = row.get(0)?;
        let Some(kind) = kind else {
            result.complete = false;
            continue;
        };
        let ts = text::timestamp(&database::scalar(row, 2)?);
        let Some(value) = database::json(row.get(1)?, &mut result, cancel)? else {
            continue;
        };
        let before_count = result.count;
        let before_total = result.total;
        match kind.as_str() {
            "user" => {
                let mut native = Vec::new();
                images::collect(&value, &mut native);
                native.extend(database::file_images(&value["files"]));
                let raw = value["text"]
                    .as_str()
                    .map(str::to_owned)
                    .unwrap_or_else(|| text::content(&value["content"]));
                transcript::emit(
                    &mut result,
                    transcript::message(SessionRole::User, raw, ts),
                    &native,
                    cancel,
                    callback,
                )?;
            }
            "assistant" => {
                let record_model = database::string(&value["model"]["id"]);
                if let Some(blocks) = value["content"].as_array() {
                    for block in blocks {
                        let (role, raw) = match block["type"].as_str() {
                            Some("text") => (SessionRole::Assistant, text::content(&block["text"])),
                            Some("reasoning") => {
                                (SessionRole::Thinking, text::content(&block["text"]))
                            }
                            Some("tool") => (
                                SessionRole::Tool,
                                format!(
                                    "{}\n{}\n{}\n{}",
                                    block["name"]
                                        .as_str()
                                        .or(block["tool"].as_str())
                                        .unwrap_or_default(),
                                    database::rendered(&block["state"]["input"]),
                                    text::content(&block["state"]["content"]),
                                    database::rendered(&block["state"]["error"])
                                ),
                            ),
                            _ => {
                                result.complete = false;
                                continue;
                            }
                        };
                        let mut native = Vec::new();
                        images::collect(block, &mut native);
                        images::collect(&block["state"]["content"], &mut native);
                        let mut message = transcript::message(role, raw, ts);
                        message.model = record_model.clone();
                        transcript::emit(&mut result, message, &native, cancel, callback)?;
                    }
                } else {
                    result.complete = false;
                }
            }
            "system" => transcript::emit(
                &mut result,
                transcript::message(SessionRole::System, text::content(&value["text"]), ts),
                &[],
                cancel,
                callback,
            )?,
            _ => {}
        }
        // A database message can contain several text parts. Its logical
        // dialogue count stays one while every part remains independently paged.
        result.count = before_count.saturating_add(u32::from(
            (kind == "user" && result.count > before_count)
                || (kind == "assistant" && result.total > before_total),
        ));
    }
    result.created = text::timestamp(&metadata.3).or(result.created);
    result.updated = text::timestamp(&metadata.4).or(result.updated);
    if result.title.is_empty() {
        result.title = result.preview.clone();
    }
    Ok(result)
}
