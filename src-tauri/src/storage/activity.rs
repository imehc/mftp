use crate::error::persistence;
use crate::error::{AppError, AppResult};
use crate::models::ActivityLog;
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;

use super::helpers::column_exists;
use super::{now_ms, Storage};

/// app_meta key holding `MAX(created_at)` of the rows that existed when the
/// `error_payload` column was first added. Later writes always carry the
/// structured error itself, so this watermark is what tells pre-column legacy
/// text apart from business metadata in `detail` — no message sniffing.
const LEGACY_WATERMARK_KEY: &str = "activity_log_error_legacy_before_ms";

impl Storage {
    pub fn record_result(
        &self,
        source: &str,
        address: &str,
        action: &str,
        detail: Option<&str>,
        error: Option<&AppError>,
    ) -> AppResult<()> {
        append_activity_log(
            self.db_path(),
            source,
            address,
            action,
            if error.is_some() { "failed" } else { "success" },
            detail,
            error,
        )
    }

    pub fn list_activity_logs(
        &self,
        limit: u32,
        source: Option<&str>,
        result: Option<&str>,
    ) -> AppResult<Vec<ActivityLog>> {
        let conn = self.conn()?;
        let legacy_before_ms = read_legacy_watermark(&conn)?;
        let mut stmt = conn.prepare(
            r#"
            SELECT id, created_at, source, ip, request_type, result, detail, error_payload
            FROM activity_logs
            WHERE (?2 IS NULL OR source = ?2)
              AND (?3 IS NULL OR result = ?3)
            ORDER BY created_at DESC
            LIMIT ?1
            "#,
        )?;
        let rows = stmt
            .query_map(params![limit, source, result], |row| {
                let created_at: i64 = row.get(1)?;
                let result: String = row.get(5)?;
                let detail: Option<String> = row.get(6)?;
                let error_payload: Option<String> = row.get(7)?;
                // Only failure outcomes carry an error; denials and other
                // static outcomes keep plain business detail.
                let error = if matches!(result.as_str(), "failed" | "canceled") {
                    match error_payload.as_deref() {
                        Some(payload) => persistence::decode(Some(payload), None),
                        // Pre-column rows: versioned compatibility read
                        // fallback, never rewritten back to storage.
                        None if created_at <= legacy_before_ms => {
                            persistence::decode(None, detail.as_deref())
                        }
                        None => None,
                    }
                } else {
                    None
                };
                Ok(ActivityLog {
                    id: row.get(0)?,
                    created_at,
                    source: row.get(2)?,
                    ip: row.get(3)?,
                    request_type: row.get(4)?,
                    result,
                    detail,
                    error,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn clear_activity_logs(&self, source: Option<&str>) -> AppResult<u32> {
        let changed = self.conn()?.execute(
            "DELETE FROM activity_logs WHERE ?1 IS NULL OR source = ?1",
            params![source],
        )?;
        Ok(changed as u32)
    }

    pub fn delete_activity_log(&self, id: &str) -> AppResult<()> {
        self.conn()?
            .execute("DELETE FROM activity_logs WHERE id = ?1", params![id])?;
        Ok(())
    }
}

pub(crate) fn append_activity_log(
    db_path: &Path,
    source: &str,
    address: &str,
    action: &str,
    result: &str,
    detail: Option<&str>,
    error: Option<&AppError>,
) -> AppResult<()> {
    let error_payload = match error {
        Some(error) => Some(persistence::encode(error)?),
        None => None,
    };
    let conn = rusqlite::Connection::open(db_path)?;
    conn.execute(
        "INSERT INTO activity_logs(id,created_at,source,ip,request_type,result,detail,error_payload) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
        params![uuid::Uuid::new_v4().to_string(), now_ms(), source, address, action, result, detail, error_payload],
    )?;
    Ok(())
}

/// Idempotently add the structured `error_payload` column. Databases created
/// after this change already have it; older ones get the column plus the
/// legacy watermark in the same startup, before any writer can run.
pub(super) fn ensure_error_payload_column(conn: &Connection) -> AppResult<()> {
    if column_exists(conn, "activity_logs", "error_payload")? {
        return Ok(());
    }
    let max_created: i64 = conn.query_row(
        "SELECT COALESCE(MAX(created_at), 0) FROM activity_logs",
        [],
        |row| row.get(0),
    )?;
    conn.execute(
        "ALTER TABLE activity_logs ADD COLUMN error_payload TEXT",
        [],
    )?;
    conn.execute(
        "INSERT INTO app_meta(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![LEGACY_WATERMARK_KEY, max_created.to_string()],
    )?;
    Ok(())
}

fn read_legacy_watermark(conn: &Connection) -> AppResult<i64> {
    let value: Option<String> = conn
        .query_row(
            "SELECT value FROM app_meta WHERE key = ?1",
            params![LEGACY_WATERMARK_KEY],
            |row| row.get(0),
        )
        .optional()?;
    // A missing or unparseable marker only disables legacy fallback wrapping;
    // structured payloads keep working regardless.
    Ok(value.and_then(|value| value.parse().ok()).unwrap_or(0))
}

/// One-time forward rename: `lan_access_logs` was the cross-module shared
/// activity log store despite the historical name (the `source` column
/// discriminates producers). Forward-only: no dual write, no view alias.
pub(super) fn migrate_table_name(conn: &Connection) -> AppResult<()> {
    if !table_exists(conn, "lan_access_logs")? {
        return Ok(());
    }
    if table_exists(conn, "activity_logs")? {
        // Only reachable after a downgrade wrote to a recreated old table.
        // Keep both as-is rather than failing startup or merging by guesswork;
        // the app keeps operating on `activity_logs`.
        eprintln!(
            "activity log table rename skipped: both lan_access_logs and activity_logs exist"
        );
        return Ok(());
    }
    // SQLite has no ALTER INDEX rename; rebuild the index under the new name.
    conn.execute_batch(
        r#"
        ALTER TABLE lan_access_logs RENAME TO activity_logs;
        DROP INDEX IF EXISTS idx_lan_access_logs_created_at;
        CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at
        ON activity_logs(created_at DESC);
        "#,
    )?;
    Ok(())
}

fn table_exists(conn: &Connection, name: &str) -> AppResult<bool> {
    Ok(conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
        params![name],
        |row| row.get(0),
    )?)
}

#[cfg(test)]
#[path = "activity_tests.rs"]
mod tests;
