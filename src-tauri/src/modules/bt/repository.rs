//! BT task registry. librqbit's session.json handles engine-side restore
//! (torrent bytes, bitfield, output folder); these tables hold app-side
//! metadata: display label, mode, pinned flag.

use crate::error::{persistence, AppError, AppResult, CustomErrorCode};
use crate::storage::Storage;
use rusqlite::{params, Connection, OptionalExtension};

#[derive(Debug, Clone)]
pub(crate) struct BtTaskRow {
    pub info_hash: String,
    pub label: String,
    pub dest_dir: String,
    /// Legacy 'preview' rows are retained until the download-only migration.
    pub mode: String,
    pub pinned: bool,
    pub created_at: i64,
    pub work_dir: String,
    pub file_indices: Vec<usize>,
    pub package_mode: String,
    pub status: String,
    pub output_path: Option<String>,
    pub export_path: Option<String>,
    pub total_bytes: Option<u64>,
    pub error: Option<AppError>,
}

fn row_from(r: &rusqlite::Row<'_>) -> rusqlite::Result<BtTaskRow> {
    Ok(BtTaskRow {
        info_hash: r.get(0)?,
        label: r.get(1)?,
        dest_dir: r.get(2)?,
        mode: r.get(3)?,
        pinned: r.get::<_, i64>(4)? != 0,
        created_at: r.get(5)?,
        work_dir: r.get(6)?,
        file_indices: serde_json::from_str(&r.get::<_, String>(7)?).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                7,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?,
        package_mode: r.get(8)?,
        status: r.get(9)?,
        output_path: r.get(10)?,
        export_path: r.get(11)?,
        total_bytes: r
            .get::<_, Option<i64>>(12)?
            .map(u64::try_from)
            .transpose()
            .map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    12,
                    rusqlite::types::Type::Integer,
                    Box::new(error),
                )
            })?,
        error: persistence::decode(
            r.get::<_, Option<String>>(14)?.as_deref(),
            r.get::<_, Option<String>>(13)?.as_deref(),
        ),
    })
}

const COLS: &str = "info_hash, label, dest_dir, mode, pinned, created_at, work_dir, file_indices, package_mode, status, output_path, export_path, total_bytes, last_error, error_payload";

fn query_all(
    conn: &Connection,
    sql: &str,
    params: &[&dyn rusqlite::ToSql],
) -> AppResult<Vec<BtTaskRow>> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt
        .query_map(params, row_from)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[derive(Clone)]
pub(crate) struct BtRepository {
    storage: Storage,
}

impl BtRepository {
    pub(crate) fn new(storage: Storage) -> Self {
        Self { storage }
    }

    pub(super) fn finish_bt_download_only_migration(&self) -> AppResult<()> {
        const MIGRATION_KEY: &str = "bt_download_only_migrated_v1";
        let mut conn = self.storage.conn()?;
        let done: Option<String> = conn
            .query_row(
                "SELECT value FROM app_meta WHERE key = ?1",
                params![MIGRATION_KEY],
                |row| row.get(0),
            )
            .optional()?;
        if done.as_deref() == Some("1") {
            return Ok(());
        }
        let transaction = conn.transaction()?;
        transaction.execute("DELETE FROM bt_tasks WHERE mode = 'preview'", [])?;
        transaction.execute("DELETE FROM bt_cache_access", [])?;
        transaction.execute("DELETE FROM app_meta WHERE key = 'bt_cache_quota'", [])?;
        transaction.execute(
            "INSERT INTO app_meta(key, value) VALUES(?1, '1')
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![MIGRATION_KEY],
        )?;
        transaction.commit()?;

        let cache_dir = self.storage.root_path().join("bt").join("cache");
        if cache_dir.exists() {
            std::fs::remove_dir_all(cache_dir)?;
        }
        Ok(())
    }

    pub(super) fn has_active_bt_tasks(&self) -> AppResult<bool> {
        let conn = self.storage.conn()?;
        let active: i64 = conn.query_row(
            "SELECT COUNT(*) FROM bt_tasks WHERE status IN ('active', 'packaging')",
            [],
            |row| row.get(0),
        )?;
        Ok(active > 0)
    }

    pub(super) fn upsert_bt_task(&self, task: &BtTaskRow) -> AppResult<()> {
        let conn = self.storage.conn()?;
        let error_payload = task.error.as_ref().map(persistence::encode).transpose()?;
        let total_bytes = task
            .total_bytes
            .map(i64::try_from)
            .transpose()
            .map_err(|_| AppError::custom(CustomErrorCode::BtTaskSizeOutOfRange))?;
        conn.execute(
            "INSERT INTO bt_tasks (
                info_hash, label, dest_dir, mode, pinned, created_at, work_dir,
                file_indices, package_mode, status, output_path, export_path,
                total_bytes, last_error, error_payload
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
             ON CONFLICT(info_hash) DO UPDATE SET
               label = excluded.label,
               dest_dir = excluded.dest_dir,
               mode = excluded.mode,
               pinned = excluded.pinned,
               work_dir = excluded.work_dir,
               file_indices = excluded.file_indices,
               package_mode = excluded.package_mode,
               status = excluded.status,
               output_path = excluded.output_path,
               export_path = excluded.export_path,
               total_bytes = excluded.total_bytes,
               last_error = excluded.last_error,
               error_payload = excluded.error_payload",
            params![
                task.info_hash,
                task.label,
                task.dest_dir,
                task.mode,
                task.pinned as i64,
                task.created_at,
                task.work_dir,
                serde_json::to_string(&task.file_indices)?,
                task.package_mode,
                task.status,
                task.output_path,
                task.export_path,
                total_bytes,
                task.error.as_ref().map(|error| error.message.as_str()),
                error_payload,
            ],
        )?;
        Ok(())
    }

    pub(super) fn list_bt_tasks(&self) -> AppResult<Vec<BtTaskRow>> {
        let conn = self.storage.conn()?;
        query_all(
            &conn,
            &format!("SELECT {COLS} FROM bt_tasks ORDER BY created_at DESC"),
            &[],
        )
    }

    pub(super) fn get_bt_task(&self, info_hash: &str) -> AppResult<Option<BtTaskRow>> {
        let conn = self.storage.conn()?;
        let mut stmt =
            conn.prepare(&format!("SELECT {COLS} FROM bt_tasks WHERE info_hash = ?1"))?;
        stmt.query_row(params![info_hash], row_from)
            .optional()
            .map_err(Into::into)
    }

    pub(super) fn delete_bt_task(&self, info_hash: &str) -> AppResult<()> {
        let conn = self.storage.conn()?;
        conn.execute(
            "DELETE FROM bt_tasks WHERE info_hash = ?1",
            params![info_hash],
        )?;
        Ok(())
    }

    pub(super) fn delete_bt_access(&self, info_hash: &str) -> AppResult<()> {
        let conn = self.storage.conn()?;
        conn.execute(
            "DELETE FROM bt_cache_access WHERE info_hash = ?1",
            params![info_hash],
        )?;
        Ok(())
    }

    pub(super) fn update_bt_task_state(
        &self,
        info_hash: &str,
        status: &str,
        output_path: Option<&str>,
        error: Option<&AppError>,
    ) -> AppResult<()> {
        let conn = self.storage.conn()?;
        let error_payload = error.map(persistence::encode).transpose()?;
        conn.execute(
            "UPDATE bt_tasks
             SET status = ?2, output_path = COALESCE(?3, output_path), last_error = ?4,
                 error_payload = ?5
             WHERE info_hash = ?1",
            params![
                info_hash,
                status,
                output_path,
                error.map(|error| error.message.as_str()),
                error_payload
            ],
        )?;
        Ok(())
    }

    pub(super) fn set_bt_task_export_path(
        &self,
        info_hash: &str,
        export_path: &str,
    ) -> AppResult<()> {
        let conn = self.storage.conn()?;
        conn.execute(
            "UPDATE bt_tasks SET export_path = ?2 WHERE info_hash = ?1",
            params![info_hash, export_path],
        )?;
        Ok(())
    }

    pub(super) fn mark_bt_task_cancelled(&self, info_hash: &str) -> AppResult<()> {
        let mut conn = self.storage.conn()?;
        let transaction = conn.transaction()?;
        transaction.execute(
            "DELETE FROM bt_cache_access WHERE info_hash = ?1",
            params![info_hash],
        )?;
        transaction.execute(
            "UPDATE bt_tasks
             SET pinned = 0, status = 'cancelled', output_path = NULL,
                 export_path = NULL, last_error = NULL, error_payload = NULL
             WHERE info_hash = ?1",
            params![info_hash],
        )?;
        transaction.commit()?;
        Ok(())
    }

    /// Pin down a plain download's completion. Previously "completed" was only
    /// derived from live engine stats, so every restart replayed history as
    /// active until handles came back. Scoped to download+direct on purpose:
    /// legacy preview rows are removed during migration, while archive rows
    /// are finalized by the packaging job.
    ///
    /// `output_path` records the completed file in the private directory; None
    /// keeps whatever the row already had.
    pub(super) fn mark_bt_task_completed(
        &self,
        info_hash: &str,
        total_bytes: Option<u64>,
        output_path: Option<&str>,
    ) -> AppResult<()> {
        let conn = self.storage.conn()?;
        let total_bytes = total_bytes
            .map(i64::try_from)
            .transpose()
            .map_err(|_| AppError::custom(CustomErrorCode::BtTaskSizeOutOfRange))?;
        conn.execute(
            "UPDATE bt_tasks
             SET status = 'completed', last_error = NULL, error_payload = NULL,
                 total_bytes = COALESCE(?2, total_bytes),
                 output_path = COALESCE(?3, output_path)
             WHERE info_hash = ?1 AND status = 'active'
               AND mode = 'download' AND package_mode = 'direct'",
            params![info_hash, total_bytes, output_path],
        )?;
        Ok(())
    }

    /// Plain downloads still waiting to finish. The engine start resumes a
    /// finalize job for each so the finished file reaches the user's folder
    /// even when the download completed with the app closed.
    pub(super) fn list_bt_direct_downloads(&self) -> AppResult<Vec<BtTaskRow>> {
        let conn = self.storage.conn()?;
        query_all(
            &conn,
            &format!(
                "SELECT {COLS} FROM bt_tasks
                 WHERE mode = 'download' AND package_mode = 'direct'
                   AND status = 'active'"
            ),
            &[],
        )
    }

    pub(super) fn list_bt_archive_tasks(&self) -> AppResult<Vec<BtTaskRow>> {
        let conn = self.storage.conn()?;
        query_all(
            &conn,
            &format!(
                "SELECT {COLS} FROM bt_tasks
                 WHERE package_mode = 'archive'
                   AND status IN ('active', 'packaging', 'completed')"
            ),
            &[],
        )
    }
}

#[cfg(test)]
#[path = "repository_tests.rs"]
mod tests;
