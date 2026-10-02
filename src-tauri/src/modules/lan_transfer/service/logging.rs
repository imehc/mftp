use crate::error::{AppError, AppErrorKind, CustomErrorCode};
use crate::storage::activity::append_activity_log;
use std::path::Path;

pub(super) fn record_access(
    db_path: &Path,
    ip: &str,
    request_type: &str,
    result: &str,
    detail: Option<&str>,
) {
    write(db_path, ip, request_type, result, detail, None);
}

/// Error-driven outcome: the full AppError goes to the versioned payload
/// column (the frontend localizes by kind/code); `detail` stays business
/// metadata such as the file name.
pub(super) fn record_access_error(
    db_path: &Path,
    ip: &str,
    request_type: &str,
    error: &AppError,
    detail: Option<&str>,
) {
    write(
        db_path,
        ip,
        request_type,
        log_result(error),
        detail,
        Some(error),
    );
}

fn write(
    db_path: &Path,
    ip: &str,
    request_type: &str,
    result: &str,
    detail: Option<&str>,
    error: Option<&AppError>,
) {
    // Audit rows are best-effort on the request hot path: a write failure must
    // never change the HTTP response, but it stays observable with the error's
    // stable code instead of being silently dropped.
    if let Err(error) = append_activity_log(db_path, "lan", ip, request_type, result, detail, error)
    {
        eprintln!(
            "failed to append LAN access log: {}: {}",
            error.code, error.message
        );
    }
}

// Cancellation is a distinct audit outcome from a real failure; classify by
// kind/code only, never by message text.
pub(super) fn log_result(error: &AppError) -> &'static str {
    if error.kind == AppErrorKind::Custom
        && error.code == CustomErrorCode::LanTransferCancelled.as_str()
    {
        "canceled"
    } else {
        "failed"
    }
}

pub(super) fn record_transfer_history(
    db_path: &Path,
    ip: &str,
    direction: &str,
    file_name: &str,
    status: &str,
) {
    write(db_path, ip, direction, status, Some(file_name), None);
}

pub(super) fn record_transfer_failure(
    db_path: &Path,
    ip: &str,
    direction: &str,
    file_name: &str,
    error: &AppError,
) {
    write(
        db_path,
        ip,
        direction,
        log_result(error),
        Some(file_name),
        Some(error),
    );
}

#[cfg(test)]
#[path = "logging_tests.rs"]
mod tests;
