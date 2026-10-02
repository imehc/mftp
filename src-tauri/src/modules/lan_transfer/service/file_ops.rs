use crate::error::{AppError, AppResult, CustomErrorCode};
use crate::modules::lan_transfer::LanSharedDir;
use std::path::PathBuf;

pub(super) fn shares_json(shares: &[LanSharedDir]) -> String {
    let items = shares
        .iter()
        .map(|share| {
            format!(
                r#"{{"id":"{}","name":"{}"}}"#,
                super::escape_json(&share.id),
                super::escape_json(&share.name)
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    format!("[{items}]")
}

pub(super) fn browse_json(first_line: &str, shares: &[LanSharedDir]) -> AppResult<String> {
    let path = resolve_request_path(first_line, shares)?;
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(path)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        let meta = entry.metadata()?;
        entries.push(format!(
            r#"{{"name":"{}","isDir":{},"size":{}}}"#,
            super::escape_json(&name),
            meta.is_dir(),
            meta.len()
        ));
    }
    Ok(format!(r#"{{"entries":[{}]}}"#, entries.join(",")))
}

pub(super) fn resolve_request_path(
    first_line: &str,
    shares: &[LanSharedDir],
) -> AppResult<PathBuf> {
    let query = first_line
        .split_whitespace()
        .nth(1)
        .and_then(|target| target.split_once('?').map(|(_, query)| query))
        .ok_or_else(|| AppError::custom(CustomErrorCode::LanRequestInvalid))?;
    let share_id = query_param(query, "share")
        .ok_or_else(|| AppError::custom(CustomErrorCode::LanShareUnknown))?;
    let rel = query_param(query, "path").unwrap_or_default();
    resolve_shared_path(&share_id, &rel, shares)
}

fn resolve_shared_path(share_id: &str, rel: &str, shares: &[LanSharedDir]) -> AppResult<PathBuf> {
    if rel.contains("..") || rel.starts_with('/') || rel.starts_with('\\') {
        return Err(AppError::custom(CustomErrorCode::LanSharedPathInvalid).with_arg("path", rel));
    }
    let share = shares
        .iter()
        .find(|item| item.id == share_id)
        .ok_or_else(|| {
            AppError::custom(CustomErrorCode::LanShareUnknown).with_arg("share", share_id)
        })?;
    let base = std::fs::canonicalize(&share.path).map_err(|_| {
        AppError::custom(CustomErrorCode::LanSharedDirUnavailable).with_arg("share", share_id)
    })?;
    // A failed canonicalize must not fall back to the share root: that would
    // silently list or serve the root when the requested path is missing.
    let target = std::fs::canonicalize(base.join(rel))
        .map_err(|error| AppError::from(error).context(format!("share target {share_id}")))?;
    if !target.starts_with(&base) {
        return Err(AppError::custom(CustomErrorCode::LanSharedPathInvalid).with_arg("path", rel));
    }
    Ok(target)
}

pub(super) fn query_param(query: &str, key: &str) -> Option<String> {
    url::form_urlencoded::parse(query.as_bytes())
        .find(|(name, _)| name == key)
        .map(|(_, value)| value.into_owned())
}

pub(super) fn request_query_param(first_line: &str, key: &str) -> Option<String> {
    let query = first_line
        .split_whitespace()
        .nth(1)
        .and_then(|target| target.split_once('?').map(|(_, query)| query))?;
    query_param(query, key)
}

#[cfg(test)]
#[path = "file_ops_tests.rs"]
mod tests;
