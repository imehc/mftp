use crate::error::{AppError, AppResult};
use crate::models::{AppDataClearResult, AppDataModule, AppDataUsage};
use rusqlite::{Connection, OpenFlags};
use std::fs;
use std::io::ErrorKind;
use std::path::Path;
use walkdir::WalkDir;

use super::{data::BT_TOMBSTONE_PREFIX, Storage};

fn file_family_size(path: &Path) -> AppResult<u64> {
    let mut bytes = 0;
    for suffix in ["", "-wal", "-shm"] {
        let mut name = path.as_os_str().to_os_string();
        name.push(suffix);
        match fs::metadata(Path::new(&name)) {
            Ok(metadata) => bytes += metadata.len(),
            // Optional databases and SQLite sidecars may not exist yet.
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    Ok(bytes)
}

fn dir_size(path: &Path) -> AppResult<u64> {
    if !path.try_exists()? {
        return Ok(0);
    }
    let mut bytes = 0;
    for entry in WalkDir::new(path) {
        let entry = entry?;
        if entry.file_type().is_file() {
            bytes += entry.metadata()?.len();
        }
    }
    Ok(bytes)
}

fn query_bytes(conn: &Connection, query: &str) -> AppResult<u64> {
    let bytes = conn.query_row(query, [], |row| row.get::<_, Option<i64>>(0))?;
    Ok(bytes.unwrap_or(0).max(0) as u64)
}

impl Storage {
    pub fn app_data_usage(&self) -> AppResult<AppDataUsage> {
        let poetry = self.root.join("poetry.sqlite3");
        let main_database_bytes = file_family_size(&self.db_path)?;
        let poetry_database_bytes = file_family_size(&poetry)?;
        let download_bytes = self.download_bytes()?;
        let translation_model_bytes = self.translation_model_bytes()?;
        let keys_bytes = dir_size(&self.root.join("keys"))?;
        // 「总占用」是应用数据目录的真实占用，包含模型、缓存等不可按模块清理的内容；
        // 只累加可清理的数据库会明显小于用户看到的磁盘占用。
        let total_bytes = dir_size(&self.root)?;
        // Unclassified leftovers are reported as cache so the rows always add up
        // to the measured directory size instead of leaving a silent gap.
        let cache_bytes = total_bytes.saturating_sub(
            main_database_bytes
                + poetry_database_bytes
                + translation_model_bytes
                + download_bytes
                + keys_bytes,
        );
        // Usage reads must never create a missing database or apply migrations.
        let conn = Connection::open_with_flags(&self.db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        let (vault_bytes, hosts_bytes, todo_bytes, activity_logs_bytes) = (
            query_bytes(
                &conn,
                "SELECT COALESCE(SUM(
                            LENGTH(CAST(COALESCE(id, '') AS BLOB)) +
                            LENGTH(CAST(COALESCE(title, '') AS BLOB)) +
                            LENGTH(CAST(COALESCE(url, '') AS BLOB)) +
                            LENGTH(CAST(COALESCE(username, '') AS BLOB)) +
                            LENGTH(CAST(COALESCE(password, '') AS BLOB)) +
                            LENGTH(CAST(COALESCE(category, '') AS BLOB)) +
                            LENGTH(CAST(COALESCE(notes, '') AS BLOB))
                        ), 0) FROM vault_entries",
            )?,
            query_bytes(
                &conn,
                "SELECT (
                            SELECT COALESCE(SUM(
                                LENGTH(CAST(COALESCE(id, '') AS BLOB)) +
                                LENGTH(CAST(COALESCE(label, '') AS BLOB)) +
                                LENGTH(CAST(COALESCE(host, '') AS BLOB)) +
                                LENGTH(CAST(COALESCE(username, '') AS BLOB)) +
                                LENGTH(CAST(COALESCE(auth_type, '') AS BLOB)) +
                                LENGTH(CAST(COALESCE(password, '') AS BLOB)) +
                                LENGTH(CAST(COALESCE(key_id, '') AS BLOB)) +
                                LENGTH(CAST(COALESCE(default_path, '') AS BLOB))
                            ), 0) FROM hosts
                        ) + (
                            SELECT COALESCE(SUM(
                                LENGTH(CAST(COALESCE(id, '') AS BLOB)) +
                                LENGTH(CAST(COALESCE(label, '') AS BLOB)) +
                                LENGTH(CAST(COALESCE(filename, '') AS BLOB)) +
                                LENGTH(CAST(COALESCE(private_key, '') AS BLOB))
                            ), 0) FROM ssh_keys
                        )",
            )?,
            query_bytes(
                &conn,
                "SELECT (SELECT COALESCE(SUM(
                            LENGTH(CAST(COALESCE(id, '') AS BLOB)) +
                            LENGTH(CAST(COALESCE(title, '') AS BLOB)) +
                            LENGTH(CAST(COALESCE(category, '') AS BLOB)) +
                            LENGTH(CAST(COALESCE(notes, '') AS BLOB)) +
                            LENGTH(CAST(COALESCE(due_date, '') AS BLOB))
                        ), 0) FROM todo_items) +
                        (SELECT COALESCE(SUM(LENGTH(CAST(document AS BLOB))),0) FROM todo_notes) +
                        (SELECT COALESCE(SUM(LENGTH(data)+LENGTH(thumbnail)),0) FROM todo_note_images)",
            )?,
            query_bytes(
                &conn,
                "SELECT COALESCE(SUM(
                            LENGTH(CAST(COALESCE(id, '') AS BLOB)) +
                            LENGTH(CAST(COALESCE(source, '') AS BLOB)) +
                            LENGTH(CAST(COALESCE(ip, '') AS BLOB)) +
                            LENGTH(CAST(COALESCE(request_type, '') AS BLOB)) +
                            LENGTH(CAST(COALESCE(result, '') AS BLOB)) +
                            LENGTH(CAST(COALESCE(detail, '') AS BLOB)) +
                            LENGTH(CAST(COALESCE(error_payload, '') AS BLOB)) +
                            LENGTH(CAST(COALESCE(operation_id, '') AS BLOB))
                        ), 0) FROM activity_logs",
            )?,
        );
        Ok(AppDataUsage {
            vault_bytes,
            hosts_bytes,
            todo_bytes,
            main_database_bytes,
            poetry_database_bytes,
            activity_logs_bytes,
            translation_model_bytes,
            download_bytes,
            keys_bytes,
            cache_bytes,
            total_bytes,
        })
    }

    /// Android keeps translation models under `no_backup`; desktops use the
    /// data directory directly, so both locations are measured.
    fn translation_model_bytes(&self) -> AppResult<u64> {
        Ok(dir_size(&self.root.join("translation-models"))?
            + dir_size(&self.root.join("no_backup").join("translation-models"))?)
    }

    fn download_bytes(&self) -> AppResult<u64> {
        let mut bytes = dir_size(&self.root.join("bt"))?;
        for entry in fs::read_dir(&self.root)? {
            let entry = entry?;
            if entry
                .file_name()
                .to_string_lossy()
                .starts_with(BT_TOMBSTONE_PREFIX)
            {
                bytes += dir_size(&entry.path())?;
            }
        }
        Ok(bytes)
    }

    pub(crate) fn freed_bytes(
        &self,
        before: AppResult<AppDataUsage>,
    ) -> (Option<u64>, Option<AppError>) {
        // Measurement must not turn a completed deletion into a failed command.
        // Unknown usage stays unknown; returning zero would claim a measurement.
        match before.and_then(|before| {
            self.app_data_usage()
                .map(|after| before.total_bytes.saturating_sub(after.total_bytes))
        }) {
            Ok(bytes) => (Some(bytes), None),
            Err(error) => (None, Some(error)),
        }
    }

    pub fn data_clear_result(
        &self,
        module: AppDataModule,
        records_deleted: u32,
        before: AppResult<AppDataUsage>,
        preserved: Vec<String>,
    ) -> AppDataClearResult {
        let (bytes_freed, usage_error) = self.freed_bytes(before);
        AppDataClearResult {
            module,
            records_deleted,
            bytes_freed,
            usage_error,
            preserved,
        }
    }
}

#[cfg(test)]
#[path = "usage_tests.rs"]
mod tests;
