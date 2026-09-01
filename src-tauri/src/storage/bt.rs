//! BT task registry. librqbit's session.json handles engine-side restore
//! (torrent bytes, bitfield, output folder); these tables hold app-side
//! metadata: display label, mode, pinned flag.

use super::Storage;
use crate::error::AppResult;
use rusqlite::{params, Connection, OptionalExtension};

#[derive(Debug, Clone)]
pub struct BtTaskRow {
    pub info_hash: String,
    pub label: String,
    pub dest_dir: String,
    /// Only 'download' for now; 'preview' (cache mode) lands with P2.
    pub mode: String,
    pub pinned: bool,
    pub created_at: i64,
    pub work_dir: String,
    pub file_indices: Vec<usize>,
    pub package_mode: String,
    pub status: String,
    pub output_path: Option<String>,
    pub total_bytes: Option<u64>,
    pub last_error: Option<String>,
}

fn row_from(r: &rusqlite::Row<'_>) -> rusqlite::Result<BtTaskRow> {
    let total_bytes = r
        .get::<_, Option<i64>>(11)?
        .map(u64::try_from)
        .transpose()
        .map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                11,
                rusqlite::types::Type::Integer,
                Box::new(error),
            )
        })?;
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
        total_bytes,
        last_error: r.get(12)?,
    })
}

const COLS: &str = "info_hash, label, dest_dir, mode, pinned, created_at, work_dir, file_indices, package_mode, status, output_path, total_bytes, last_error";

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

impl Storage {
    pub fn upsert_bt_task(&self, task: &BtTaskRow) -> AppResult<()> {
        let conn = self.conn()?;
        let total_bytes = task
            .total_bytes
            .map(i64::try_from)
            .transpose()
            .map_err(|_| crate::error::AppError("BT 任务大小超出数据库范围".into()))?;
        conn.execute(
            "INSERT INTO bt_tasks (
                info_hash, label, dest_dir, mode, pinned, created_at, work_dir,
                file_indices, package_mode, status, output_path, total_bytes, last_error
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
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
               total_bytes = excluded.total_bytes,
               last_error = excluded.last_error",
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
                total_bytes,
                task.last_error,
            ],
        )?;
        Ok(())
    }

    pub fn list_bt_tasks(&self) -> AppResult<Vec<BtTaskRow>> {
        let conn = self.conn()?;
        query_all(
            &conn,
            &format!("SELECT {COLS} FROM bt_tasks ORDER BY created_at DESC"),
            &[],
        )
    }

    pub fn get_bt_task(&self, info_hash: &str) -> AppResult<Option<BtTaskRow>> {
        let conn = self.conn()?;
        let mut stmt =
            conn.prepare(&format!("SELECT {COLS} FROM bt_tasks WHERE info_hash = ?1"))?;
        stmt.query_row(params![info_hash], row_from)
            .optional()
            .map_err(Into::into)
    }

    pub fn delete_bt_task(&self, info_hash: &str) -> AppResult<()> {
        let conn = self.conn()?;
        conn.execute(
            "DELETE FROM bt_tasks WHERE info_hash = ?1",
            params![info_hash],
        )?;
        Ok(())
    }

    /// Refresh cache access time (LRU basis). Preview tasks only.
    pub fn touch_bt_access(&self, info_hash: &str) -> AppResult<()> {
        let conn = self.conn()?;
        conn.execute(
            "INSERT INTO bt_cache_access (info_hash, last_access) VALUES (?1, ?2)
             ON CONFLICT(info_hash) DO UPDATE SET last_access = excluded.last_access",
            params![info_hash, super::now_ms()],
        )?;
        Ok(())
    }

    pub fn delete_bt_access(&self, info_hash: &str) -> AppResult<()> {
        let conn = self.conn()?;
        conn.execute(
            "DELETE FROM bt_cache_access WHERE info_hash = ?1",
            params![info_hash],
        )?;
        Ok(())
    }

    pub fn has_bt_access(&self, info_hash: &str) -> AppResult<bool> {
        let conn = self.conn()?;
        let mut stmt =
            conn.prepare("SELECT 1 FROM bt_cache_access WHERE info_hash = ?1 LIMIT 1")?;
        Ok(stmt
            .query_row(params![info_hash], |_| Ok(()))
            .optional()?
            .is_some())
    }

    pub fn mark_bt_cache_cleared(
        &self,
        info_hash: &str,
        total_bytes: Option<u64>,
    ) -> AppResult<()> {
        let mut conn = self.conn()?;
        let total_bytes = total_bytes
            .map(i64::try_from)
            .transpose()
            .map_err(|_| crate::error::AppError("BT 任务大小超出数据库范围".into()))?;
        let transaction = conn.transaction()?;
        transaction.execute(
            "DELETE FROM bt_cache_access WHERE info_hash = ?1",
            params![info_hash],
        )?;
        transaction.execute(
            "UPDATE bt_tasks
             SET pinned = 0, status = 'completed', output_path = NULL,
                 total_bytes = COALESCE(?2, total_bytes), last_error = NULL
             WHERE info_hash = ?1 AND mode = 'preview'",
            params![info_hash, total_bytes],
        )?;
        transaction.commit()?;
        Ok(())
    }

    /// Preview tasks by last access ascending (stalest first).
    pub fn list_cache_lru(&self) -> AppResult<Vec<(String, i64)>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            "SELECT t.info_hash, a.last_access
             FROM bt_tasks t
             INNER JOIN bt_cache_access a ON a.info_hash = t.info_hash
             WHERE t.mode = 'preview'
             ORDER BY a.last_access ASC",
        )?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn set_bt_pinned(&self, info_hash: &str, pinned: bool) -> AppResult<()> {
        let conn = self.conn()?;
        conn.execute(
            "UPDATE bt_tasks SET pinned = ?2 WHERE info_hash = ?1",
            params![info_hash, pinned as i64],
        )?;
        Ok(())
    }

    pub fn update_bt_task_state(
        &self,
        info_hash: &str,
        status: &str,
        output_path: Option<&str>,
        error: Option<&str>,
    ) -> AppResult<()> {
        let conn = self.conn()?;
        conn.execute(
            "UPDATE bt_tasks
             SET status = ?2, output_path = COALESCE(?3, output_path), last_error = ?4
             WHERE info_hash = ?1",
            params![info_hash, status, output_path, error],
        )?;
        Ok(())
    }

    pub fn mark_bt_task_cancelled(&self, info_hash: &str) -> AppResult<()> {
        let mut conn = self.conn()?;
        let transaction = conn.transaction()?;
        transaction.execute(
            "DELETE FROM bt_cache_access WHERE info_hash = ?1",
            params![info_hash],
        )?;
        transaction.execute(
            "UPDATE bt_tasks
             SET pinned = 0, status = 'cancelled', output_path = NULL, last_error = NULL
             WHERE info_hash = ?1",
            params![info_hash],
        )?;
        transaction.commit()?;
        Ok(())
    }

    /// Pin down a plain download's completion. Previously "completed" was only
    /// derived from live engine stats, so every restart replayed history as
    /// active until handles came back. Scoped to download+direct on purpose:
    /// for preview rows 'completed' means "cache cleared"
    /// (`mark_bt_cache_cleared`), and archive rows are finalized by the
    /// packaging job.
    ///
    /// `output_path` records where the finished file was moved to; None keeps
    /// whatever the row already had.
    pub fn mark_bt_task_completed(
        &self,
        info_hash: &str,
        total_bytes: Option<u64>,
        output_path: Option<&str>,
    ) -> AppResult<()> {
        let conn = self.conn()?;
        let total_bytes = total_bytes
            .map(i64::try_from)
            .transpose()
            .map_err(|_| crate::error::AppError("BT 任务大小超出数据库范围".into()))?;
        conn.execute(
            "UPDATE bt_tasks
             SET status = 'completed', last_error = NULL,
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
    pub fn list_bt_direct_downloads(&self) -> AppResult<Vec<BtTaskRow>> {
        let conn = self.conn()?;
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

    pub fn list_bt_archive_tasks(&self) -> AppResult<Vec<BtTaskRow>> {
        let conn = self.conn()?;
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

    // ---- app_meta key-value (lightweight settings such as cache quota) ----

    pub fn get_meta(&self, key: &str) -> AppResult<Option<String>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare("SELECT value FROM app_meta WHERE key = ?1")?;
        stmt.query_row(params![key], |r| r.get::<_, String>(0))
            .optional()
            .map_err(Into::into)
    }

    pub fn set_meta(&self, key: &str, value: &str) -> AppResult<()> {
        let conn = self.conn()?;
        conn.execute(
            "INSERT INTO app_meta (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("mftp-bt-db-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    fn sample_row(hash: &str) -> BtTaskRow {
        BtTaskRow {
            info_hash: hash.into(),
            label: "archive".into(),
            dest_dir: "/downloads".into(),
            mode: "download".into(),
            pinned: true,
            created_at: 123,
            work_dir: "/app/bt/staging/hash".into(),
            file_indices: vec![1, 3],
            package_mode: "archive".into(),
            status: "packaging".into(),
            output_path: Some("/downloads/archive.tar.gz".into()),
            total_bytes: Some(456),
            last_error: Some("retryable".into()),
        }
    }

    #[test]
    fn upsert_round_trips_archive_state() {
        let root = temp_root("upsert");
        let storage = Storage::new(root.clone()).unwrap();
        let row = sample_row(&"a".repeat(40));
        storage.upsert_bt_task(&row).unwrap();
        let loaded = storage.get_bt_task(&row.info_hash).unwrap().unwrap();
        assert_eq!(loaded.file_indices, vec![1, 3]);
        assert_eq!(loaded.package_mode, "archive");
        assert_eq!(loaded.status, "packaging");
        assert_eq!(loaded.output_path, row.output_path);
        assert_eq!(loaded.total_bytes, Some(456));
        assert_eq!(loaded.last_error.as_deref(), Some("retryable"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn old_schema_migrates_to_direct_active_task() {
        let root = temp_root("migration");
        let db = root.join("mftp.sqlite3");
        let conn = Connection::open(&db).unwrap();
        conn.execute_batch(
            "CREATE TABLE bt_tasks (
                info_hash TEXT PRIMARY KEY,
                label TEXT NOT NULL,
                dest_dir TEXT NOT NULL,
                mode TEXT NOT NULL DEFAULT 'download',
                pinned INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
             );
             INSERT INTO bt_tasks VALUES (
                'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                'legacy', '/downloads', 'download', 0, 1
             );",
        )
        .unwrap();
        drop(conn);

        let storage = Storage::new(root.clone()).unwrap();
        let row = storage
            .get_bt_task("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
            .unwrap()
            .unwrap();
        assert_eq!(row.work_dir, "/downloads");
        assert!(row.file_indices.is_empty());
        assert_eq!(row.package_mode, "direct");
        assert_eq!(row.status, "active");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn clearing_preview_cache_keeps_history_outside_cache_lru() {
        let root = temp_root("cache-history");
        let storage = Storage::new(root.clone()).unwrap();
        let hash = "b".repeat(40);
        let mut row = sample_row(&hash);
        row.mode = "preview".into();
        row.package_mode = "direct".into();
        row.status = "active".into();
        row.total_bytes = None;
        storage.upsert_bt_task(&row).unwrap();
        storage.touch_bt_access(&hash).unwrap();

        assert!(storage.has_bt_access(&hash).unwrap());
        assert_eq!(storage.list_cache_lru().unwrap().len(), 1);

        storage.mark_bt_cache_cleared(&hash, Some(789)).unwrap();

        let history = storage.get_bt_task(&hash).unwrap().unwrap();
        assert_eq!(history.status, "completed");
        assert_eq!(history.total_bytes, Some(789));
        assert!(!history.pinned);
        assert!(!storage.has_bt_access(&hash).unwrap());
        assert!(storage.list_cache_lru().unwrap().is_empty());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn completing_only_touches_plain_downloads() {
        let root = temp_root("complete");
        let storage = Storage::new(root.clone()).unwrap();

        let direct = "d".repeat(40);
        let mut row = sample_row(&direct);
        row.package_mode = "direct".into();
        row.status = "active".into();
        row.total_bytes = None;
        row.last_error = Some("transient".into());
        storage.upsert_bt_task(&row).unwrap();

        let preview = "e".repeat(40);
        let mut cached = sample_row(&preview);
        cached.mode = "preview".into();
        cached.package_mode = "direct".into();
        cached.status = "active".into();
        storage.upsert_bt_task(&cached).unwrap();

        let archive = "f".repeat(40);
        let mut packing = sample_row(&archive);
        packing.status = "active".into();
        storage.upsert_bt_task(&packing).unwrap();

        assert_eq!(
            storage
                .list_bt_direct_downloads()
                .unwrap()
                .into_iter()
                .map(|row| row.info_hash)
                .collect::<Vec<_>>(),
            vec![direct.clone()]
        );

        for hash in [&direct, &preview, &archive] {
            storage
                .mark_bt_task_completed(hash, Some(999), Some("/downloads/movie.mp4"))
                .unwrap();
        }

        let done = storage.get_bt_task(&direct).unwrap().unwrap();
        assert_eq!(done.status, "completed");
        assert_eq!(done.total_bytes, Some(999));
        assert_eq!(done.output_path.as_deref(), Some("/downloads/movie.mp4"));
        assert_eq!(done.last_error, None);
        assert_eq!(
            storage.get_bt_task(&preview).unwrap().unwrap().status,
            "active"
        );
        assert_eq!(
            storage.get_bt_task(&archive).unwrap().unwrap().status,
            "active"
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cancelling_task_keeps_history_and_clears_runtime_state() {
        let root = temp_root("cancel-history");
        let storage = Storage::new(root.clone()).unwrap();
        let hash = "c".repeat(40);
        let mut row = sample_row(&hash);
        row.pinned = true;
        storage.upsert_bt_task(&row).unwrap();
        storage.touch_bt_access(&hash).unwrap();

        storage.mark_bt_task_cancelled(&hash).unwrap();

        let history = storage.get_bt_task(&hash).unwrap().unwrap();
        assert_eq!(history.status, "cancelled");
        assert_eq!(history.output_path, None);
        assert_eq!(history.last_error, None);
        assert!(!history.pinned);
        assert!(!storage.has_bt_access(&hash).unwrap());
        std::fs::remove_dir_all(root).unwrap();
    }
}
