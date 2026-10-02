//! Versioned storage boundary. Never rewrite an unknown envelope while reading it.

use super::{AppError, AppResult};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
struct StoredError {
    version: u32,
    error: AppError,
}

pub(crate) fn encode(error: &AppError) -> AppResult<String> {
    Ok(serde_json::to_string(&StoredError {
        version: 1,
        error: error.clone(),
    })?)
}

pub(crate) fn decode(payload: Option<&str>, legacy: Option<&str>) -> Option<AppError> {
    if let Some(payload) = payload {
        if let Ok(stored) = serde_json::from_str::<StoredError>(payload) {
            if stored.version == 1
                && !stored.error.code.trim().is_empty()
                && !stored.error.message.trim().is_empty()
            {
                return Some(stored.error);
            }
        }
    }
    // This is the sole compatibility boundary for pre-protocol stored text.
    // Historical messages are not classified by their wording or parsed as JSON.
    legacy
        .filter(|message| !message.trim().is_empty())
        .map(|message| AppError::external("legacy:raw", message.to_owned()))
        .or_else(|| {
            payload.map(|_| {
                AppError::external(
                    "storage:error_payload",
                    "Stored error details use an unsupported or invalid format",
                )
            })
        })
}

#[cfg(test)]
#[path = "persistence_tests.rs"]
mod tests;
