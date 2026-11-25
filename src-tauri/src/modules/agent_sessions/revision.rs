use std::os::unix::fs::MetadataExt;
use std::path::Path;
use std::time::UNIX_EPOCH;

use crate::error::{AppError, AppResult, CustomErrorCode};

pub(super) fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub(super) fn fingerprint(path: &Path) -> AppResult<(String, f64)> {
    let metadata = path.metadata()?;
    let modified = metadata
        .modified()?
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    Ok((
        format!(
            "{}:{}:{}:{}",
            metadata.len(),
            modified.as_nanos(),
            metadata.dev(),
            metadata.ino()
        ),
        modified.as_secs_f64() * 1000.0,
    ))
}

pub(super) fn revision_length(revision: &str) -> AppResult<u64> {
    revision
        .split(':')
        .next()
        .and_then(|value| value.parse().ok())
        .ok_or_else(|| AppError::custom(CustomErrorCode::AgentSessionChanged))
}

pub(super) fn compatible_revision(current: &str, original: &str) -> bool {
    let current: Vec<_> = current.split(':').collect();
    let original: Vec<_> = original.split(':').collect();
    if current.len() != 4 || original.len() != 4 || current[2..] != original[2..] {
        return false;
    }
    match (current[0].parse::<u64>(), original[0].parse::<u64>()) {
        (Ok(now), Ok(before)) => now > before || (now == before && current[1] == original[1]),
        _ => false,
    }
}
