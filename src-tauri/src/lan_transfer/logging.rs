use crate::storage::activity::append_activity_log;
use std::path::Path;

pub(super) fn record_access(
    db_path: &Path,
    ip: &str,
    request_type: &str,
    result: &str,
    detail: Option<&str>,
) {
    let _ = append_activity_log(db_path, "lan", ip, request_type, result, detail);
}

pub(super) fn record_transfer_history(
    db_path: &Path,
    ip: &str,
    direction: &str,
    file_name: &str,
    status: &str,
    detail: Option<&str>,
) {
    let combined_detail = match detail {
        Some(detail) => format!("{file_name} · {detail}"),
        None => file_name.to_string(),
    };
    record_access(db_path, ip, direction, status, Some(&combined_detail));
}
