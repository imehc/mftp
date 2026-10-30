use crate::error::persistence;
use crate::error::{AppError, AppResult};
use crate::models::ActivityLog;
#[cfg(test)]
use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension};
#[cfg(test)]
use std::path::{Path, PathBuf};

use super::helpers::column_exists;
use super::{now_ms, Storage};

/// app_meta key holding `MAX(created_at)` of the rows that existed when the
/// `error_payload` column was first added. Later writes always carry the
/// structured error itself, so this watermark is what tells pre-column legacy
/// text apart from business metadata in `detail` — no message sniffing.
const LEGACY_WATERMARK_KEY: &str = "activity_log_error_legacy_before_ms";

impl Storage {
    pub(crate) fn record_traced_result(
        &self,
        source: &str,
        address: &str,
        action: &str,
        detail: Option<&str>,
        error: Option<&AppError>,
        operation_id: &str,
    ) -> AppResult<()> {
        self.logs.operation(ActivityLog {
            id: uuid::Uuid::new_v4().to_string(),
            created_at: now_ms(),
            source: source.into(),
            ip: address.into(),
            request_type: action.into(),
            result: if error.is_some() { "failed" } else { "success" }.into(),
            detail: detail.map(str::to_owned),
            error: error.cloned(),
            operation_id: Some(operation_id.into()),
        });
        Ok(())
    }
    pub fn record_result(
        &self,
        source: &str,
        address: &str,
        action: &str,
        detail: Option<&str>,
        error: Option<&AppError>,
    ) -> AppResult<()> {
        self.logs.operation(ActivityLog {
            id: uuid::Uuid::new_v4().to_string(),
            created_at: now_ms(),
            source: source.into(),
            ip: address.into(),
            request_type: action.into(),
            result: if error.is_some() { "failed" } else { "success" }.into(),
            detail: detail.map(str::to_owned),
            error: error.cloned(),
            operation_id: None,
        });
        Ok(())
    }

    pub fn list_activity_logs(
        &self,
        limit: u32,
        source: Option<&str>,
        result: Option<&str>,
    ) -> AppResult<Vec<ActivityLog>> {
        let mut logs: Vec<_> = self
            .logs
            .projection(None)?
            .summaries
            .into_values()
            .filter(|row| {
                source.is_none_or(|value| value == row.source)
                    && result.is_none_or(|value| value == row.result)
            })
            .collect();
        // Read-only compatibility for a downgrade or an interrupted migration.
        // New production writes never target this table.
        let known: std::collections::HashSet<_> = logs.iter().map(|row| row.id.clone()).collect();
        logs.extend(
            self.legacy_activity_logs(limit, source, result)?
                .into_iter()
                .filter(|row| !known.contains(&row.id)),
        );
        logs.sort_by(|left, right| {
            right
                .created_at
                .cmp(&left.created_at)
                .then_with(|| right.id.cmp(&left.id))
        });
        logs.truncate(limit as usize);
        Ok(logs)
    }

    fn legacy_activity_logs(
        &self,
        limit: u32,
        source: Option<&str>,
        result: Option<&str>,
    ) -> AppResult<Vec<ActivityLog>> {
        let conn = self.conn()?;
        let legacy_before_ms = read_legacy_watermark(&conn)?;
        let mut stmt = conn.prepare(
            r#"
            SELECT id, created_at, source, ip, request_type, result, detail, error_payload, operation_id
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
                    operation_id: row.get(8)?,
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
        if source.is_some() {
            return Err(AppError::external(
                "logs:clear-scope",
                "Logs are cleared by file date, not module",
            ));
        }
        let count = self
            .list_activity_logs(u32::MAX, None, None)?
            .len()
            .min(u32::MAX as usize) as u32;
        self.logs.clear(None)?;
        // Remove only rows left by an older build or a downgrade. The current
        // writer never appends here, so this cannot create a second log store.
        let conn = self.conn()?;
        conn.execute("DELETE FROM activity_logs", [])?;
        Ok(count)
    }

    pub fn delete_activity_log(&self, id: &str) -> AppResult<()> {
        Err(AppError::external(
            "logs:delete-record",
            "Individual log deletion is unsupported",
        )
        .with_arg("id", id))
    }

    pub(crate) fn migrate_activity_files(&self) -> AppResult<()> {
        loop {
            let records = self.legacy_activity_logs(500, None, None)?;
            if records.is_empty() {
                break;
            }
            self.logs.import_legacy(&records)?;
            let mut conn = self.conn()?;
            let tx = conn.transaction()?;
            for record in records {
                tx.execute("DELETE FROM activity_logs WHERE id=?1", [record.id])?;
            }
            tx.commit()?;
        }
        self.conn()?.execute("INSERT INTO app_meta(key,value) VALUES('activity_file_schema_version','1') ON CONFLICT(key) DO UPDATE SET value=excluded.value", [])?;
        Ok(())
    }
}

#[cfg(test)]
pub(crate) fn append_activity_log(
    db_path: &Path,
    source: &str,
    address: &str,
    action: &str,
    result: &str,
    detail: Option<&str>,
    error: Option<&AppError>,
) -> AppResult<()> {
    append_traced_log(
        db_path, source, address, action, result, detail, error, None,
    )
}

#[expect(
    clippy::too_many_arguments,
    reason = "Preserve the existing activity writer contract while attaching an optional execution identity"
)]
#[cfg(test)]
fn append_traced_log(
    db_path: &Path,
    source: &str,
    address: &str,
    action: &str,
    result: &str,
    detail: Option<&str>,
    error: Option<&AppError>,
    operation_id: Option<&str>,
) -> AppResult<()> {
    let error_payload = match error {
        Some(error) => Some(persistence::encode(error)?),
        None => None,
    };
    // LAN requests log on every access; reuse one connection per database
    // instead of reopening the file. SQLite serializes writers anyway.
    static CACHED: Mutex<Option<(PathBuf, Connection)>> = Mutex::new(None);
    let mut cached = CACHED.lock();
    let conn = match cached.take() {
        Some((path, conn)) if path == db_path => conn,
        _ => Connection::open(db_path)?,
    };
    conn.execute(
        "INSERT INTO activity_logs(id,created_at,source,ip,request_type,result,detail,error_payload,operation_id) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![uuid::Uuid::new_v4().to_string(), now_ms(), source, address, action, result, detail, error_payload, operation_id],
    )?;
    // A failed write drops the connection so the next call reopens it.
    *cached = Some((db_path.to_path_buf(), conn));
    Ok(())
}

pub(super) fn ensure_diagnostics_schema(conn: &Connection) -> AppResult<()> {
    // Version 1 is additive. Reopening after a partial migration is harmless;
    // historical rows remain null and no prior detail/error data is rewritten.
    if !column_exists(conn, "activity_logs", "operation_id")? {
        conn.execute("ALTER TABLE activity_logs ADD COLUMN operation_id TEXT", [])?;
    }
    conn.execute("INSERT INTO app_meta(key,value) VALUES('activity_diagnostics_schema_version','1') ON CONFLICT(key) DO NOTHING", [])?;
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
///
/// The legacy table's absence is the completion marker: once no
/// `lan_access_logs` remains there is nothing left to check, so no separate
/// `app_meta` flag is needed (a flag could disagree with the actual schema,
/// e.g. after restoring a database or a downgrade writing to the old table).
pub(super) fn migrate_table_name(conn: &Connection) -> AppResult<()> {
    if !table_exists(conn, "lan_access_logs")? {
        return Ok(());
    }
    if !table_exists(conn, "activity_logs")? {
        // SQLite has no ALTER INDEX rename; rebuild the index under the new name.
        conn.execute_batch(
            r#"
            ALTER TABLE lan_access_logs RENAME TO activity_logs;
            DROP INDEX IF EXISTS idx_lan_access_logs_created_at;
            CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at
            ON activity_logs(created_at DESC);
            "#,
        )?;
        return Ok(());
    }
    // Both tables exist: an earlier build created `activity_logs` while the
    // legacy table was still in place, so the rename guard can never fire
    // again. Rows carry the same meaning and the legacy table only has a
    // subset of the columns, so merge by primary key and drop it instead of
    // leaving an orphan table that every startup has to re-examine.
    // `INSERT OR IGNORE` keeps the new table's row on an id collision; the
    // merge and the drop commit together, so an interrupted run retries.
    if !column_exists(conn, "activity_logs", "source")? {
        conn.execute(
            "ALTER TABLE activity_logs ADD COLUMN source TEXT NOT NULL DEFAULT 'lan'",
            [],
        )?;
    }
    let tx = conn.unchecked_transaction()?;
    // `source` was added after the table rename, so a very old database may
    // still lack it; default the same value the column would carry.
    if column_exists(conn, "lan_access_logs", "source")? {
        tx.execute(
            "INSERT OR IGNORE INTO activity_logs(id, created_at, source, ip, request_type, result, detail)
             SELECT id, created_at, source, ip, request_type, result, detail FROM lan_access_logs",
            [],
        )?;
    } else {
        tx.execute(
            "INSERT OR IGNORE INTO activity_logs(id, created_at, source, ip, request_type, result, detail)
             SELECT id, created_at, 'lan', ip, request_type, result, detail FROM lan_access_logs",
            [],
        )?;
    }
    tx.execute_batch(
        r#"
        DROP INDEX IF EXISTS idx_lan_access_logs_created_at;
        DROP TABLE lan_access_logs;
        "#,
    )?;
    tx.commit()?;
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
