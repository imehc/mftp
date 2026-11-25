use std::sync::atomic::{AtomicBool, Ordering};

use serde_json::Value;

use crate::error::{AppError, AppResult, CustomErrorCode};

const MAX_BYTES: usize = 32 * 1024 * 1024;
const MAX_WEIGHT: usize = 64 * 1024 * 1024;

pub(super) fn parse(bytes: &[u8], cancel: &AtomicBool) -> AppResult<Value> {
    if bytes.len() > MAX_BYTES {
        return Err(AppError::custom(CustomErrorCode::AgentSessionLimit));
    }
    // Bound serde's tree allocation before decoding. Tiny scalar arrays can
    // consume much more memory than their serialized input size.
    let mut quoted = false;
    let mut escaped = false;
    let mut token = false;
    let mut weight = bytes.len();
    for (index, byte) in bytes.iter().copied().enumerate() {
        if index % 65_536 == 0 && cancel.load(Ordering::Acquire) {
            return Err(AppError::custom(CustomErrorCode::AgentSessionCancelled));
        }
        if quoted {
            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == b'"' {
                quoted = false;
            }
        } else if byte == b'"' {
            quoted = true;
            token = false;
            weight = weight.saturating_add(128);
        } else if matches!(byte, b'[' | b'{') {
            token = false;
            weight = weight.saturating_add(128);
        } else if byte.is_ascii_whitespace() || matches!(byte, b',' | b':' | b']' | b'}') {
            token = false;
        } else if !token {
            token = true;
            weight = weight.saturating_add(128);
        }
        if weight > MAX_WEIGHT {
            return Err(AppError::custom(CustomErrorCode::AgentSessionLimit));
        }
    }
    serde_json::from_slice(bytes).map_err(|_| AppError::custom(CustomErrorCode::AgentSessionFormat))
}
