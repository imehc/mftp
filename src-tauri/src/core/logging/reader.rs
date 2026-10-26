use super::{delta, Event, LogEntry, LogFile, LogPage, LogService, Payload, EVENT_BYTES};
use crate::{
    core::diagnostics::DiagnosticOperation,
    error::{AppError, AppResult},
    models::ActivityLog,
};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::{BufRead, BufReader, Read},
    path::Path,
    time::UNIX_EPOCH,
};

#[derive(Default)]
pub(crate) struct LogProjection {
    pub summaries: BTreeMap<String, ActivityLog>,
    pub operations: BTreeMap<String, Value>,
    pub malformed: u32,
    pub discarded: u32,
}

pub(super) fn files(root: &Path) -> AppResult<Vec<LogFile>> {
    let mut files = Vec::new();
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if !managed(&name) || !entry.file_type()?.is_file() {
            continue;
        }
        let metadata = entry.metadata()?;
        files.push(LogFile {
            protected: name.starts_with("mftp-migrated-"),
            id: name,
            bytes: metadata.len() as f64,
            modified_at: metadata
                .modified()?
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as f64,
        });
    }
    files.sort_by(|left, right| left.id.cmp(&right.id));
    Ok(files)
}

fn managed(name: &str) -> bool {
    let Some(stem) = name
        .strip_prefix("mftp-")
        .and_then(|value| value.strip_suffix(".jsonl"))
    else {
        return false;
    };
    let Some((prefix, segment)) = stem.rsplit_once('-') else {
        return false;
    };
    if segment.len() != 6 || !segment.bytes().all(|byte| byte.is_ascii_digit()) || prefix.len() < 37
    {
        return false;
    }
    let (date, run) = prefix.split_at(prefix.len() - 36);
    uuid::Uuid::parse_str(run).is_ok()
        && (date == "migrated-"
            || date.len() == 11
                && date.ends_with('-')
                && date[..10]
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || byte == b'-'))
}

impl LogService {
    pub(crate) fn files(&self) -> AppResult<Vec<LogFile>> {
        self.flush()?;
        files(&self.root)
    }

    pub(crate) fn directory(&self) -> &Path {
        &self.root
    }

    pub(crate) fn usage(&self) -> AppResult<u64> {
        Ok(files(&self.root)?
            .iter()
            .map(|file| file.bytes as u64)
            .sum())
    }

    pub(crate) fn projection(&self, detail: Option<&str>) -> AppResult<LogProjection> {
        self.flush()?;
        let mut projection = LogProjection::default();
        for file in files(&self.root)? {
            let input = File::open(self.root.join(file.id))?;
            let size = input.metadata()?.len();
            let mut reader = BufReader::new(input.take(size));
            loop {
                let mut line = Vec::new();
                let read = reader
                    .by_ref()
                    .take((EVENT_BYTES + 1) as u64)
                    .read_until(b'\n', &mut line)?;
                if read == 0 {
                    break;
                }
                if line.len() > EVENT_BYTES || !line.ends_with(b"\n") {
                    projection.malformed = projection.malformed.saturating_add(1);
                    if !line.ends_with(b"\n") {
                        let mut discarded = Vec::new();
                        loop {
                            discarded.clear();
                            let count = reader
                                .by_ref()
                                .take(8192)
                                .read_until(b'\n', &mut discarded)?;
                            if count == 0 || discarded.ends_with(b"\n") {
                                break;
                            }
                        }
                    }
                    continue;
                }
                let event = match serde_json::from_slice::<Event>(&line) {
                    Ok(event) if event.schema_version == 1 => event,
                    _ => {
                        projection.malformed = projection.malformed.saturating_add(1);
                        continue;
                    }
                };
                projection.apply(event, detail);
                if projection
                    .summaries
                    .len()
                    .saturating_add(projection.operations.len())
                    > 100_000
                {
                    return Err(AppError::external(
                        "logs:query-capacity",
                        "Log query exceeds the metadata budget; narrow the retention range",
                    ));
                }
            }
        }
        Ok(projection)
    }

    pub(crate) fn page(&self, after: Option<&str>, limit: u32) -> AppResult<LogPage> {
        let generation = self.generation();
        let projection = self.projection(None)?;
        let mut health = self.health();
        health.malformed = projection.malformed;
        health.discarded = health.discarded.max(projection.discarded);
        let mut entries = projection.entries();
        entries.sort_by(|left, right| {
            right
                .timestamp
                .total_cmp(&left.timestamp)
                .then_with(|| right.id.cmp(&left.id))
        });
        let start = if let Some(after) = after {
            let (version, id) = after
                .split_once(':')
                .ok_or_else(|| AppError::external("logs:cursor", "Invalid log cursor"))?;
            if version.parse::<u64>().ok() != Some(generation) {
                return Err(AppError::external(
                    "logs:cursor",
                    "Log files changed; restart the query",
                ));
            }
            entries
                .iter()
                .position(|entry| entry.id == id)
                .map(|index| index + 1)
                .ok_or_else(|| {
                    AppError::external("logs:cursor", "Log cursor is no longer available")
                })?
        } else {
            0
        };
        let limit = limit.clamp(1, 500) as usize;
        let end = (start + limit).min(entries.len());
        let next = (end < entries.len()).then(|| format!("{generation}:{}", entries[end - 1].id));
        Ok(LogPage {
            entries: entries.drain(start..end).collect(),
            next,
            health,
        })
    }

    pub(crate) fn detail(&self, id: &str) -> AppResult<Option<DiagnosticOperation>> {
        let mut projection = self.projection(Some(id))?;
        projection
            .operations
            .remove(id)
            .map(serde_json::from_value)
            .transpose()
            .map_err(AppError::from)
    }
}

impl LogProjection {
    fn apply(&mut self, event: Event, detail: Option<&str>) {
        match event.payload {
            Payload::Operation { record } => {
                if detail.is_none() {
                    self.summaries.insert(record.id.clone(), record);
                }
            }
            Payload::Protocol {
                operation_id,
                changes,
            } => {
                if detail.is_some_and(|id| id != operation_id) {
                    return;
                }
                let value = self.operations.entry(operation_id).or_insert(Value::Null);
                if !delta::apply_projection(value, &changes, detail.is_some()) {
                    self.malformed = self.malformed.saturating_add(1);
                }
            }
            Payload::Runtime {
                module,
                action,
                result,
                message,
                operation_id,
            } => {
                if detail.is_some() {
                    return;
                }
                let record = ActivityLog {
                    id: event.event_id,
                    created_at: event.timestamp,
                    source: "runtime".into(),
                    ip: module,
                    request_type: action,
                    result,
                    detail: Some(message),
                    operation_id,
                    error: None,
                };
                self.summaries.insert(record.id.clone(), record);
            }
            Payload::Gap { discarded } => {
                self.discarded = self
                    .discarded
                    .saturating_add(discarded.min(u32::MAX as u64) as u32);
            }
        }
    }

    fn entries(self) -> Vec<LogEntry> {
        let mut entries = BTreeMap::new();
        for (id, value) in self.operations {
            if let Ok(operation) = serde_json::from_value::<DiagnosticOperation>(value) {
                entries.insert(
                    id.clone(),
                    LogEntry {
                        id,
                        timestamp: operation.started_at,
                        summary: None,
                        operation: Some(operation),
                    },
                );
            }
        }
        for (_, summary) in self.summaries {
            let id = summary
                .operation_id
                .clone()
                .unwrap_or_else(|| summary.id.clone());
            let entry = entries.entry(id.clone()).or_insert_with(|| LogEntry {
                id,
                timestamp: summary.created_at as f64,
                summary: None,
                operation: None,
            });
            entry.summary = Some(summary);
        }
        entries.into_values().collect()
    }
}
