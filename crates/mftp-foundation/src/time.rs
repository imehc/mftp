//! Shared persisted timestamp convention.

use std::time::{SystemTime, UNIX_EPOCH};

/// Unix milliseconds; preserve the existing pre-epoch fallback.
pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}
