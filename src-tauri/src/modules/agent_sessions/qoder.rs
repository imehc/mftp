use std::sync::atomic::AtomicBool;
use std::time::Instant;

use rusqlite::{Connection, OptionalExtension};

use super::database::{self, MAX_RECORD_BYTES, MAX_ROWS};
use super::images::NativeImage;
use super::model::{AgentSessionMessage, SessionContentAvailability, SessionRole};
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
    let metadata = connection.query_row("SELECT CASE WHEN length(CAST(session_title AS BLOB))<=?2 THEN session_title END,CASE WHEN length(CAST(project_uri AS BLOB))<=?2 THEN project_uri END,CASE WHEN length(CAST(preferred_model_info AS BLOB))<=?2 THEN preferred_model_info END,gmt_create,gmt_modified FROM chat_session WHERE session_id=?1", rusqlite::params![id, MAX_RECORD_BYTES as i64], |row| {
        Ok((database::scalar(row, 0)?, database::scalar(row, 1)?, database::scalar(row, 2)?, database::scalar(row, 3)?, database::scalar(row, 4)?))
    }).optional()?.ok_or_else(|| AppError::custom(CustomErrorCode::AgentSessionMissing))?;
    let mut result = Transcript {
        id: Some(id.to_owned()),
        title: text::safe_preview(metadata.0.as_str().unwrap_or_default()),
        cwd: metadata.1.as_str().unwrap_or_default().into(),
        created: database::timestamp(&metadata.3),
        updated: database::timestamp(&metadata.4),
        content_availability: SessionContentAvailability::Encrypted,
        ..Transcript::default()
    };
    let model = if let Some(raw) = metadata.2.as_str().filter(|raw| !raw.trim().is_empty()) {
        database::json(Some(raw.to_owned()), &mut result, cancel)?
    } else {
        None
    };
    result.model = model.as_ref().and_then(|model| {
        database::string(&model["model"]).or_else(|| database::string(&model["name"]))
    });
    // Ciphertext content is deliberately absent from this SELECT. It never
    // crosses the adapter, even when it resembles a base64/plaintext string.
    let mut statement = connection.prepare("SELECT CASE WHEN length(CAST(role AS BLOB))<=32 THEN role END,CASE WHEN length(CAST(tool_result AS BLOB))<=?2 THEN tool_result END,gmt_create FROM chat_message WHERE session_id=?1 ORDER BY gmt_create,id LIMIT 200001")?;
    let mut rows = statement.query(rusqlite::params![id, MAX_RECORD_BYTES as i64])?;
    let mut records = 0;
    while let Some(row) = rows.next()? {
        database::check(cancel, start)?;
        records += 1;
        if records > MAX_ROWS {
            result.complete = false;
            break;
        }
        let role: Option<String> = row.get(0)?;
        let Some(role) = role else {
            result.complete = false;
            continue;
        };
        if matches!(role.as_str(), "user" | "assistant") {
            result.count = result.count.saturating_add(1);
            continue;
        }
        let raw: Option<String> = row.get(1)?;
        let Some(raw) = raw else {
            result.complete = false;
            continue;
        };
        if raw.trim().is_empty() {
            continue;
        }
        let ts = database::timestamp(&database::scalar(row, 2)?);
        let value = database::json(Some(raw.clone()), &mut result, cancel)?;
        let readable = value
            .as_ref()
            .map(|value| {
                format!(
                    "{}\n{}\n{}",
                    value["toolCallName"].as_str().unwrap_or_default(),
                    database::rendered(&value["parameters"]),
                    value
                        .get("content")
                        .or_else(|| value.get("results"))
                        .map(database::rendered)
                        .unwrap_or_default()
                )
            })
            .unwrap_or(raw);
        transcript::emit(
            &mut result,
            transcript::message(SessionRole::Tool, readable, ts),
            &[],
            cancel,
            callback,
        )?;
    }
    if database::has_table(connection, "agent_memory")? {
        let mut statement = connection.prepare("SELECT CASE WHEN length(CAST(title AS BLOB))<=?2 THEN title END,CASE WHEN length(CAST(content AS BLOB))<=?2 THEN content END,gmt_create FROM agent_memory WHERE session_id=?1 AND status='active' ORDER BY gmt_create,id LIMIT 10001")?;
        let mut rows = statement.query(rusqlite::params![id, MAX_RECORD_BYTES as i64])?;
        let mut records = 0;
        while let Some(row) = rows.next()? {
            database::check(cancel, start)?;
            records += 1;
            if records > 10_000 {
                result.complete = false;
                break;
            }
            let title: Option<String> = row.get(0)?;
            let Some(content) = row.get::<_, Option<String>>(1)? else {
                result.complete = false;
                continue;
            };
            if content.trim().is_empty() {
                continue;
            }
            if result.preview.is_empty() {
                result.preview = text::safe_preview(&content);
            }
            let ts = database::timestamp(&database::scalar(row, 2)?);
            transcript::emit(
                &mut result,
                transcript::message(
                    SessionRole::System,
                    format!("{}\n{}", title.unwrap_or_default(), content),
                    ts,
                ),
                &[],
                cancel,
                callback,
            )?;
        }
    }
    result.created = database::timestamp(&metadata.3).or(result.created);
    result.updated = database::timestamp(&metadata.4).or(result.updated);
    if result.title.is_empty() {
        result.title = result.preview.clone();
    }
    Ok(result)
}
