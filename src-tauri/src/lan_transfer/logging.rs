use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

pub(super) fn record_access(
    db_path: &Path,
    ip: &str,
    request_type: &str,
    result: &str,
    detail: Option<&str>,
) {
    let Ok(conn) = rusqlite::Connection::open(db_path) else {
        return;
    };
    let created_at = now_ms();
    let _ = conn.execute(
        r#"
        INSERT INTO lan_access_logs(
            id, created_at, source, ip, request_type, result, detail
        ) VALUES(?1, ?2, 'lan', ?3, ?4, ?5, ?6)
        "#,
        rusqlite::params![
            uuid::Uuid::new_v4().to_string(),
            created_at,
            ip,
            request_type,
            result,
            detail,
        ],
    );
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

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}
