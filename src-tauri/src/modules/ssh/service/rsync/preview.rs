//! Dry-run itemize/progress parsing and the short-lived preview registry.
//! Preview tokens are single-use: execution removes the record before any
//! transfer I/O so a confirmed preview cannot be replayed.

use crate::modules::ssh::{RsyncChangeKind, RsyncDirection, RsyncPreviewItem};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::time::{Duration, Instant};

pub(super) const PREVIEW_ITEMS_LIMIT: usize = 500;
const PREVIEW_TTL: Duration = Duration::from_secs(10 * 60);
const PREVIEW_LIMIT: usize = 32;
const ITEMIZE_PREFIX: usize = 12;

#[derive(Debug, Default, PartialEq, Eq)]
pub(super) struct ItemizedSummary {
    pub(super) added: u32,
    pub(super) updated: u32,
    pub(super) deleted: u32,
    pub(super) items: Vec<RsyncPreviewItem>,
    pub(super) truncated: bool,
}

pub(super) fn parse_itemized(output: &[u8], limit: usize) -> ItemizedSummary {
    let text = String::from_utf8_lossy(output);
    let mut summary = ItemizedSummary::default();
    for line in text.split(['\n', '\r']) {
        let Some(item) = parse_item(line) else {
            continue;
        };
        match item.kind {
            RsyncChangeKind::Added => summary.added = summary.added.saturating_add(1),
            RsyncChangeKind::Updated => summary.updated = summary.updated.saturating_add(1),
            RsyncChangeKind::Deleted => summary.deleted = summary.deleted.saturating_add(1),
        }
        if summary.items.len() < limit {
            summary.items.push(item);
        } else {
            summary.truncated = true;
        }
    }
    summary
}

fn parse_item(line: &str) -> Option<RsyncPreviewItem> {
    let bytes = line.as_bytes();
    if bytes.len() <= ITEMIZE_PREFIX || bytes[ITEMIZE_PREFIX - 1] != b' ' {
        return None;
    }
    let token = line.get(..ITEMIZE_PREFIX - 1)?;
    if !token.is_ascii() {
        return None;
    }
    let (kind, deleted) = if is_deleting_token(token) {
        (RsyncChangeKind::Deleted, true)
    } else {
        let first = *bytes.first()?;
        if first == b'.' || first == b'*' {
            return None;
        }
        if !matches!(first, b'<' | b'>' | b'c' | b'h') {
            return None;
        }
        let file_type = *bytes.get(1)?;
        if !matches!(file_type, b'f' | b'd' | b'L' | b'D' | b'S') {
            return None;
        }
        let added = bytes[2..ITEMIZE_PREFIX - 1]
            .iter()
            .all(|byte| *byte == b'+');
        let kind = if added {
            RsyncChangeKind::Added
        } else {
            RsyncChangeKind::Updated
        };
        (kind, false)
    };
    let file_type = *bytes.get(1)?;
    let mut path = line.get(ITEMIZE_PREFIX..)?;
    if !deleted && file_type == b'L' {
        if let Some(index) = path.rfind(" -> ") {
            path = &path[..index];
        }
    }
    let is_dir = if deleted {
        path.ends_with('/')
    } else {
        file_type == b'd' || path.ends_with('/')
    };
    let path = path.trim_start_matches("./").trim_end_matches('/');
    if path.is_empty() {
        return None;
    }
    Some(RsyncPreviewItem {
        kind,
        path: path.to_string(),
        is_dir,
    })
}

fn is_deleting_token(token: &str) -> bool {
    token
        .strip_prefix("*deleting")
        .is_some_and(|rest| rest.trim().is_empty())
}

/// The last complete `--info=progress2` segment. Progress lines carry
/// `(xfr#N, to-chk=M/T)`; incomplete trailing segments are ignored so a
/// chunk boundary cannot report a truncated number.
pub(super) fn last_progress_bytes(output: &[u8]) -> u64 {
    let text = String::from_utf8_lossy(output);
    text.split(['\r', '\n'])
        .rev()
        .find_map(parse_progress_segment)
        .unwrap_or(0)
}

fn parse_progress_segment(segment: &str) -> Option<u64> {
    if !segment.contains("to-chk=") && !segment.contains("xfr#") {
        return None;
    }
    let field = segment.split_whitespace().next()?;
    let digits: String = field.chars().filter(char::is_ascii_digit).collect();
    if digits.is_empty() {
        return None;
    }
    digits.parse().ok()
}

pub(super) struct PreviewRecord {
    pub(super) session_id: String,
    pub(super) direction: RsyncDirection,
    pub(super) local_dir: String,
    pub(super) remote_dir: String,
    pub(super) delete_extraneous: bool,
    pub(super) created_at: Instant,
}

#[derive(Default)]
pub(super) struct PreviewRegistry {
    records: Mutex<HashMap<String, PreviewRecord>>,
}

impl PreviewRegistry {
    pub(super) fn insert(&self, mut record: PreviewRecord) -> String {
        let token = uuid::Uuid::new_v4().simple().to_string();
        record.created_at = Instant::now();
        let mut records = self.records.lock();
        purge_expired(&mut records);
        while records.len() >= PREVIEW_LIMIT {
            let Some(oldest) = records
                .iter()
                .min_by_key(|(_, record)| record.created_at)
                .map(|(token, _)| token.clone())
            else {
                break;
            };
            records.remove(&oldest);
        }
        records.insert(token.clone(), record);
        token
    }

    pub(super) fn take(&self, token: &str) -> Option<PreviewRecord> {
        let mut records = self.records.lock();
        purge_expired(&mut records);
        records.remove(token)
    }

    pub(super) fn forget_session(&self, session_id: &str) {
        self.records
            .lock()
            .retain(|_, record| record.session_id != session_id);
    }

    pub(super) fn clear(&self) {
        self.records.lock().clear();
    }
}

fn purge_expired(records: &mut HashMap<String, PreviewRecord>) {
    let now = Instant::now();
    records.retain(|_, record| now.saturating_duration_since(record.created_at) < PREVIEW_TTL);
}

#[cfg(test)]
#[path = "preview_tests.rs"]
mod tests;
