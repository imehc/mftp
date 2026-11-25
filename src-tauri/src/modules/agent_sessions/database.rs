use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use rusqlite::{types::ValueRef, Connection, Row};
use serde_json::Value;

use super::images::NativeImage;
use super::model::{AgentSessionMessage, SessionAgent};
use super::transcript::Transcript;
use crate::error::{AppError, AppResult, CustomErrorCode};

pub(super) const MAX_RECORD_BYTES: usize = 32 * 1024 * 1024;
pub(super) const MAX_ROWS: usize = 200_000;

pub(super) fn check(cancel: &AtomicBool, start: Instant) -> AppResult<()> {
    if cancel.load(Ordering::Acquire) {
        return Err(AppError::custom(CustomErrorCode::AgentSessionCancelled));
    }
    if start.elapsed() > Duration::from_secs(30) {
        return Err(AppError::custom(CustomErrorCode::AgentSessionLimit));
    }
    Ok(())
}

pub(super) fn has_table(connection: &Connection, table: &str) -> AppResult<bool> {
    Ok(connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
        [table],
        |row| row.get(0),
    )?)
}

pub(super) fn scalar(row: &Row<'_>, index: usize) -> rusqlite::Result<Value> {
    Ok(match row.get_ref(index)? {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(value) => Value::from(value),
        ValueRef::Real(value) => Value::from(value),
        ValueRef::Text(value) if value.len() <= MAX_RECORD_BYTES => {
            Value::String(String::from_utf8_lossy(value).into_owned())
        }
        _ => Value::Null,
    })
}

pub(super) fn json(
    raw: Option<String>,
    transcript: &mut Transcript,
    cancel: &AtomicBool,
) -> AppResult<Option<Value>> {
    let Some(raw) = raw else {
        transcript.complete = false;
        return Ok(None);
    };
    match super::json::parse(raw.as_bytes(), cancel) {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.code == CustomErrorCode::AgentSessionFormat.as_str() => {
            transcript.complete = false;
            Ok(None)
        }
        Err(error) => Err(error),
    }
}

pub(super) fn string(value: &Value) -> Option<String> {
    value
        .as_str()
        .filter(|value| !value.trim().is_empty())
        .map(|value| super::text::clip(value, 200))
}

pub(super) fn rendered(value: &Value) -> String {
    if value.is_null() {
        String::new()
    } else {
        value
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| value.to_string())
    }
}

pub(super) fn file_images<'a>(files: &'a Value) -> Vec<NativeImage<'a>> {
    let mut images = Vec::new();
    let Some(files) = files.as_array() else {
        return images;
    };
    for file in files.iter().take(20) {
        let mime = file["mime"].as_str().or(file["mimeType"].as_str());
        if !mime.is_some_and(|mime| mime.starts_with("image/")) && file["type"] != "image" {
            continue;
        }
        let name = file["filename"]
            .as_str()
            .or(file["name"].as_str())
            .unwrap_or("image")
            .to_owned();
        let Some(source) = file["url"].as_str().or(file["path"].as_str()) else {
            continue;
        };
        if let Some((prefix, data)) = source.split_once(',') {
            if prefix.starts_with("data:image/") && prefix.ends_with(";base64") {
                images.push(NativeImage::Inline { data, name });
                continue;
            }
        }
        let path = match url::Url::parse(source) {
            Ok(url) => url.to_file_path().ok(),
            Err(_) => Some(PathBuf::from(source)),
        };
        if let Some(path) = path {
            images.push(NativeImage::File { path, name });
        }
    }
    images
}

pub(super) fn timestamp(value: &Value) -> Option<f64> {
    super::text::timestamp(value).or_else(|| {
        value
            .as_str()
            .and_then(|value| {
                chrono::NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S%.f").ok()
            })
            .map(|value| value.and_utc().timestamp_millis() as f64)
    })
}

pub(super) fn sessions(
    connection: &Connection,
    agent: SessionAgent,
    cancel: &AtomicBool,
) -> AppResult<Vec<String>> {
    super::sqlite_snapshot::run(connection, cancel, || {
        sessions_inner(connection, agent, cancel)
    })
}

fn sessions_inner(
    connection: &Connection,
    agent: SessionAgent,
    cancel: &AtomicBool,
) -> AppResult<Vec<String>> {
    let start = Instant::now();
    check(cancel, start)?;
    let sql = match agent {
        SessionAgent::Opencode => "SELECT CASE WHEN length(CAST(id AS BLOB))<=512 THEN id END FROM session_v2 WHERE EXISTS(SELECT 1 FROM session_message m WHERE m.session_id=session_v2.id) LIMIT 10001",
        SessionAgent::Qoder if has_table(connection, "chat_sessions")? => "SELECT CASE WHEN length(CAST(session_id AS BLOB))<=512 THEN session_id END FROM chat_sessions WHERE (deleted_at IS NULL OR deleted_at=0 OR deleted_at='') AND EXISTS(SELECT 1 FROM chat_session_messages m WHERE m.session_id=chat_sessions.session_id) LIMIT 10001",
        SessionAgent::Qoder if has_table(connection, "chat_session")? => "SELECT CASE WHEN length(CAST(session_id AS BLOB))<=512 THEN session_id END FROM chat_session WHERE EXISTS(SELECT 1 FROM chat_message m WHERE m.session_id=chat_session.session_id) LIMIT 10001",
        _ => return Err(AppError::custom(CustomErrorCode::AgentSessionFormat)),
    };
    let mut statement = connection.prepare(sql)?;
    let mut rows = statement.query([])?;
    let mut ids = Vec::new();
    while let Some(row) = rows.next()? {
        check(cancel, start)?;
        let id: Option<String> = row.get(0)?;
        let Some(id) = id else {
            return Err(AppError::custom(CustomErrorCode::AgentSessionPartial));
        };
        if id.is_empty() || id.len() > 512 {
            return Err(AppError::custom(CustomErrorCode::AgentSessionPartial));
        }
        ids.push(id);
        if ids.len() > 10_000 {
            return Err(AppError::custom(CustomErrorCode::AgentSessionLimit));
        }
    }
    Ok(ids)
}

pub(super) fn visit(
    connection: &Connection,
    agent: SessionAgent,
    session_id: &str,
    cancel: &AtomicBool,
    mut callback: impl FnMut(AgentSessionMessage, &[NativeImage<'_>]) -> AppResult<()>,
) -> AppResult<Transcript> {
    super::sqlite_snapshot::run(connection, cancel, || {
        visit_inner(connection, agent, session_id, cancel, &mut callback)
    })
}

fn visit_inner(
    connection: &Connection,
    agent: SessionAgent,
    session_id: &str,
    cancel: &AtomicBool,
    callback: &mut impl FnMut(AgentSessionMessage, &[NativeImage<'_>]) -> AppResult<()>,
) -> AppResult<Transcript> {
    let start = Instant::now();
    check(cancel, start)?;
    match agent {
        SessionAgent::Opencode => super::opencode::visit(connection, session_id, cancel, callback),
        SessionAgent::Qoder if has_table(connection, "chat_sessions")? => {
            super::qoder_desktop::visit(connection, session_id, cancel, callback)
        }
        SessionAgent::Qoder if has_table(connection, "chat_session")? => {
            super::qoder::visit(connection, session_id, cancel, callback)
        }
        _ => Err(AppError::custom(CustomErrorCode::AgentSessionFormat)),
    }
}
