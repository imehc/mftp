#[cfg(not(test))]
use crate::core::logging;
use crate::error::{AppError, AppErrorKind, CustomErrorCode};

pub(super) fn record_access(
    db_path: &std::path::Path,
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
    db_path: &std::path::Path,
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
    _db_path: &std::path::Path,
    ip: &str,
    request_type: &str,
    result: &str,
    detail: Option<&str>,
    error: Option<&AppError>,
) {
    // Tests keep their historical isolated SQLite fixture; production always
    // uses the process-wide file writer and never falls back to SQL.
    #[cfg(test)]
    {
        let _ = crate::storage::activity::append_activity_log(
            _db_path,
            "lan",
            ip,
            request_type,
            result,
            detail,
            error,
        );
        return;
    }
    #[cfg(not(test))]
    {
        let Some(logs) = logging::global() else {
            return;
        };
        logs.operation(crate::models::ActivityLog {
            id: uuid::Uuid::new_v4().to_string(),
            created_at: crate::storage::now_ms(),
            source: "lan".into(),
            ip: ip.into(),
            request_type: request_type.into(),
            result: result.into(),
            detail: detail.map(str::to_owned),
            error: error.cloned(),
            operation_id: None,
        });
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
    db_path: &std::path::Path,
    ip: &str,
    direction: &str,
    file_name: &str,
    status: &str,
) {
    write(db_path, ip, direction, status, Some(file_name), None);
}

pub(super) fn record_transfer_failure(
    db_path: &std::path::Path,
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
