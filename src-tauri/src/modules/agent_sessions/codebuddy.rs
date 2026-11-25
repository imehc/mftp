use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use rusqlite::Connection;
use serde_json::Value;
use sha2::{Digest, Sha256};

use super::images::NativeImage;
use super::model::{AgentSessionMessage, SessionRole};
use super::revision;
use super::transcript::{self, Transcript};
use super::{images, text};
use crate::error::{AppError, AppResult, CustomErrorCode};

const MAX_RECORD_BYTES: u64 = 32 * 1024 * 1024;
const MAX_MESSAGES: usize = 50_000;

#[derive(Clone)]
pub(super) struct Metadata {
    pub database: PathBuf,
    pub revision: String,
    pub deleted: bool,
    pub id: String,
    pub title: String,
    pub cwd: String,
    pub created: Option<f64>,
    pub updated: Option<f64>,
}

fn error(code: CustomErrorCode) -> AppError {
    AppError::custom(code)
}

pub(super) fn metadata(
    connection: &Connection,
    database: &Path,
    revision: &str,
    cancel: &AtomicBool,
) -> AppResult<HashMap<String, Metadata>> {
    super::sqlite_snapshot::run(connection, cancel, || {
        metadata_inner(connection, database, revision, cancel)
    })
}

fn metadata_inner(
    connection: &Connection,
    database: &Path,
    revision: &str,
    cancel: &AtomicBool,
) -> AppResult<HashMap<String, Metadata>> {
    let mut statement = connection.prepare("SELECT CASE WHEN length(CAST(value AS BLOB))<=1048576 THEN value END FROM ItemTable WHERE key LIKE 'session:%' LIMIT 10001")?;
    let mut rows = statement.query([])?;
    let mut result = HashMap::new();
    let mut records = 0;
    let started = Instant::now();
    while let Some(row) = rows.next()? {
        if cancel.load(Ordering::Acquire) {
            return Err(error(CustomErrorCode::AgentSessionCancelled));
        }
        records += 1;
        if records > 10_000 || started.elapsed() > Duration::from_secs(30) {
            return Err(error(CustomErrorCode::AgentSessionLimit));
        }
        let raw: String = row
            .get::<_, Option<String>>(0)?
            .ok_or_else(|| error(CustomErrorCode::AgentSessionLimit))?;
        if raw.len() > 1024 * 1024 {
            return Err(error(CustomErrorCode::AgentSessionLimit));
        }
        let value = super::json::parse(raw.as_bytes(), cancel)?;
        let deleted = value.get("deletedAt").is_some_and(|value| !value.is_null());
        let id = value["conversationId"]
            .as_str()
            .filter(|id| !id.is_empty() && id.len() <= 200)
            .ok_or_else(|| error(CustomErrorCode::AgentSessionFormat))?;
        result.insert(
            id.to_owned(),
            Metadata {
                database: database.to_path_buf(),
                revision: revision.to_owned(),
                deleted,
                id: id.to_owned(),
                title: text::safe_preview(value["title"].as_str().unwrap_or_default()),
                cwd: text::safe_preview(value["cwd"].as_str().unwrap_or_default()),
                created: text::timestamp(&value["createdAt"]),
                updated: text::timestamp(&value["updatedAt"]),
            },
        );
    }
    Ok(result)
}

fn json(path: &Path, cancel: &AtomicBool) -> AppResult<Value> {
    let file = File::open(path)?;
    if file.metadata()?.len() > MAX_RECORD_BYTES {
        return Err(error(CustomErrorCode::AgentSessionLimit));
    }
    let mut bytes = Vec::new();
    file.take(MAX_RECORD_BYTES + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_RECORD_BYTES {
        return Err(error(CustomErrorCode::AgentSessionLimit));
    }
    super::json::parse(&bytes, cancel)
}

pub(super) fn has_records(path: &Path, cancel: &AtomicBool) -> AppResult<bool> {
    let value = json(path, cancel)?;
    value["messages"]
        .as_array()
        .map(|messages| !messages.is_empty())
        .ok_or_else(|| error(CustomErrorCode::AgentSessionFormat))
}

fn ordered_paths(path: &Path, cancel: &AtomicBool) -> AppResult<Vec<PathBuf>> {
    let index = json(path, cancel)?;
    let ids = index["messages"]
        .as_array()
        .ok_or_else(|| error(CustomErrorCode::AgentSessionFormat))?;
    if ids.len() > MAX_MESSAGES {
        return Err(error(CustomErrorCode::AgentSessionLimit));
    }
    let root = path
        .parent()
        .ok_or_else(|| error(CustomErrorCode::AgentSessionFormat))?
        .canonicalize()?;
    let mut seen = HashSet::new();
    let mut paths = Vec::with_capacity(ids.len());
    for id in ids {
        if cancel.load(Ordering::Acquire) {
            return Err(error(CustomErrorCode::AgentSessionCancelled));
        }
        let id = id
            .as_str()
            .or_else(|| id["id"].as_str())
            .filter(|id| {
                !id.is_empty()
                    && id.len() <= 200
                    && id
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
            })
            .ok_or_else(|| error(CustomErrorCode::AgentSessionFormat))?;
        if !seen.insert(id) {
            return Err(error(CustomErrorCode::AgentSessionFormat));
        }
        let file = root
            .join("messages")
            .join(format!("{id}.json"))
            .canonicalize()?;
        if !file.starts_with(root.join("messages")) {
            return Err(error(CustomErrorCode::AgentSessionRead));
        }
        paths.push(file);
    }
    Ok(paths)
}

pub(super) fn fingerprint(path: &Path, cancel: &AtomicBool) -> AppResult<(String, f64)> {
    let (original, updated) = revision::fingerprint(path)?;
    let mut hash = Sha256::new();
    hash.update(original.as_bytes());
    for file in ordered_paths(path, cancel)? {
        if cancel.load(Ordering::Acquire) {
            return Err(error(CustomErrorCode::AgentSessionCancelled));
        }
        hash.update(file.as_os_str().as_encoded_bytes());
        hash.update(revision::fingerprint(&file)?.0.as_bytes());
    }
    if revision::fingerprint(path)?.0 != original {
        return Err(error(CustomErrorCode::AgentSessionChanged));
    }
    Ok((revision::hex(&hash.finalize()), updated))
}

pub(super) fn visit(
    path: &Path,
    metadata: &Metadata,
    cancel: &AtomicBool,
    mut callback: impl FnMut(AgentSessionMessage, &[NativeImage<'_>]) -> AppResult<()>,
) -> AppResult<Transcript> {
    let mut transcript = Transcript {
        id: Some(metadata.id.clone()),
        title: metadata.title.clone(),
        cwd: metadata.cwd.clone(),
        ..Transcript::default()
    };
    let started = Instant::now();
    for path in ordered_paths(path, cancel)? {
        if cancel.load(Ordering::Acquire) {
            return Err(error(CustomErrorCode::AgentSessionCancelled));
        }
        if started.elapsed() > Duration::from_secs(45) {
            return Err(error(CustomErrorCode::AgentSessionLimit));
        }
        let value = match json(&path, cancel) {
            Ok(value) => value,
            Err(err) if err.code == CustomErrorCode::AgentSessionFormat.as_str() => {
                transcript.complete = false;
                continue;
            }
            Err(err) => return Err(err),
        };
        let role = match value["role"].as_str() {
            Some("user") => SessionRole::User,
            Some("assistant") => SessionRole::Assistant,
            Some("tool") => SessionRole::Tool,
            Some("system") => SessionRole::System,
            _ => {
                transcript.complete = false;
                continue;
            }
        };
        let raw = value["message"]
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| text::content(&value["message"]));
        let mut message = transcript::message(role, raw, text::timestamp(&value["createdAt"]));
        // Only message-level evidence describes the historical model. The
        // workspace's selectedModelId is the current composer preference.
        let extra = if let Some(raw) = value["extra"].as_str().filter(|raw| !raw.trim().is_empty())
        {
            match super::json::parse(raw.as_bytes(), cancel) {
                Ok(extra) => Some(extra),
                Err(err) if err.code == CustomErrorCode::AgentSessionFormat.as_str() => {
                    transcript.complete = false;
                    None
                }
                Err(err) => return Err(err),
            }
        } else {
            Some(value["extra"].clone())
        };
        let extra = extra.as_ref().unwrap_or(&Value::Null);
        message.model = extra["modelId"]
            .as_str()
            .or(extra["modelName"].as_str())
            .filter(|model| !model.is_empty())
            .map(|model| text::clip(model, 200));
        if role == SessionRole::Assistant {
            transcript.model = message.model.clone();
        }
        let mut sources = Vec::new();
        images::collect(&value["message"], &mut sources);
        images::collect(&value["references"], &mut sources);
        images::collect(&extra["sourceContentBlocks"], &mut sources);
        transcript::emit(&mut transcript, message, &sources, cancel, &mut callback)?;
    }
    transcript.created = metadata.created.or(transcript.created);
    transcript.updated = metadata.updated.or(transcript.updated);
    if transcript.title.is_empty() {
        transcript.title = transcript.preview.clone();
    }
    Ok(transcript)
}
