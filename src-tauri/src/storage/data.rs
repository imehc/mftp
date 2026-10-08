use crate::error::{AppError, AppResult, CustomErrorCode};
use crate::models::{AppDataClearResult, AppDataModule, AppDataUsage};
use rusqlite::Connection;
use std::fs;
use std::path::Path;
use walkdir::WalkDir;

use super::Storage;

// A reset detaches the live BT directory into this prefix before deleting;
// leftovers from a failed pass are swept by the next `Storage::new`.
const BT_TOMBSTONE_PREFIX: &str = "bt.pending-delete-";

fn detach_bt_directory(path: &Path, tombstone: &Path) -> AppResult<bool> {
    // An inaccessible path is not an absent one. Never delete in place if
    // rename fails: the next engine must not reuse a tree with live writers.
    if !path.try_exists()? {
        return Ok(false);
    }
    fs::rename(path, tombstone)?;
    Ok(true)
}

fn file_family_size(path: &Path) -> u64 {
    ["", "-wal", "-shm"]
        .iter()
        .filter_map(|suffix| fs::metadata(format!("{}{}", path.display(), suffix)).ok())
        .map(|metadata| metadata.len())
        .sum()
}

fn dir_size(path: &Path) -> u64 {
    if !path.exists() {
        return 0;
    }
    WalkDir::new(path)
        .into_iter()
        .filter_map(Result::ok)
        .filter_map(|entry| entry.metadata().ok())
        .filter(|metadata| metadata.is_file())
        .map(|metadata| metadata.len())
        .sum()
}

fn query_bytes(conn: &Connection, query: &str) -> u64 {
    conn.query_row(query, [], |row| row.get::<_, Option<i64>>(0))
        .ok()
        .flatten()
        .unwrap_or(0)
        .max(0) as u64
}

impl Storage {
    pub fn app_data_usage(&self) -> AppDataUsage {
        let poetry = self.root.join("poetry.sqlite3");
        let main_database_bytes = file_family_size(&self.db_path);
        let poetry_database_bytes = file_family_size(&poetry);
        let bt_internal_bytes = self.bt_internal_bytes();
        let (vault_bytes, hosts_bytes, todo_bytes, activity_logs_bytes) = self
            .conn()
            .ok()
            .map(|conn| {
                (
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
                    ),
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
                    ),
                    query_bytes(
                        &conn,
                        "SELECT COALESCE(SUM(
                            LENGTH(CAST(COALESCE(id, '') AS BLOB)) +
                            LENGTH(CAST(COALESCE(title, '') AS BLOB)) +
                            LENGTH(CAST(COALESCE(category, '') AS BLOB)) +
                            LENGTH(CAST(COALESCE(notes, '') AS BLOB)) +
                            LENGTH(CAST(COALESCE(due_date, '') AS BLOB))
                        ), 0) FROM todo_items",
                    ),
                    query_bytes(
                        &conn,
                        "SELECT COALESCE(SUM(
                            LENGTH(CAST(COALESCE(id, '') AS BLOB)) +
                            LENGTH(CAST(COALESCE(source, '') AS BLOB)) +
                            LENGTH(CAST(COALESCE(ip, '') AS BLOB)) +
                            LENGTH(CAST(COALESCE(request_type, '') AS BLOB)) +
                            LENGTH(CAST(COALESCE(result, '') AS BLOB)) +
                            LENGTH(CAST(COALESCE(detail, '') AS BLOB)) +
                            LENGTH(CAST(COALESCE(error_payload, '') AS BLOB))
                        ), 0) FROM activity_logs",
                    ),
                )
            })
            .unwrap_or_default();
        AppDataUsage {
            vault_bytes,
            hosts_bytes,
            todo_bytes,
            main_database_bytes,
            poetry_database_bytes,
            activity_logs_bytes,
            bt_internal_bytes,
            total_bytes: main_database_bytes + poetry_database_bytes + bt_internal_bytes,
        }
    }

    pub fn clear_data_module(&self, module: AppDataModule) -> AppResult<u32> {
        let mut conn = self.conn()?;
        let tx = conn.transaction()?;
        let changed = match module {
            AppDataModule::Vault => tx.execute("DELETE FROM vault_entries", [])?,
            AppDataModule::Hosts => {
                tx.execute("DELETE FROM hosts", [])? + tx.execute("DELETE FROM ssh_keys", [])?
            }
            AppDataModule::Todo => tx.execute("DELETE FROM todo_items", [])?,
            AppDataModule::ActivityLogs => tx.execute("DELETE FROM activity_logs", [])?,
            AppDataModule::Poetry => {
                // The entry layer routes poetry clears to its own database;
                // reaching here means a caller bypassed that routing.
                return Err(AppError::custom(
                    CustomErrorCode::AppDataModuleSeparateStore,
                ));
            }
        };
        tx.commit()?;
        Ok(changed as u32)
    }

    pub fn clear_poetry_database(&self) -> AppResult<()> {
        let path = self.root.join("poetry.sqlite3");
        for suffix in ["", "-wal", "-shm"] {
            let target = format!("{}{}", path.display(), suffix);
            if Path::new(&target).exists() {
                fs::remove_file(target)?;
            }
        }
        let temp_dir = self.root.join("poetry-tmp");
        if temp_dir.exists() {
            fs::remove_dir_all(temp_dir)?;
        }
        Ok(())
    }

    pub fn reset_database(&self) -> AppResult<u32> {
        let mut conn = self.conn()?;
        let tx = conn.transaction()?;
        let tables = [
            "hosts",
            "ssh_keys",
            "activity_logs",
            "vault_entries",
            "todo_items",
            "app_meta",
        ];
        let mut changed = crate::modules::bt::schema::reset(&tx)?;
        changed += crate::modules::lan_transfer::schema::reset(&tx)?;
        changed += crate::modules::ai::schema::reset(&tx)?;
        changed += crate::modules::model_viewer::schema::reset(&tx)?;
        for table in tables {
            changed += match table {
                "hosts" => tx.execute("DELETE FROM hosts", [])?,
                "ssh_keys" => tx.execute("DELETE FROM ssh_keys", [])?,
                "activity_logs" => tx.execute("DELETE FROM activity_logs", [])?,
                "vault_entries" => tx.execute("DELETE FROM vault_entries", [])?,
                "todo_items" => tx.execute("DELETE FROM todo_items", [])?,
                // Schema versions and retired-source markers describe the
                // retained database, not user preferences. Clearing them can
                // replay ALTER TABLE or reimport deleted legacy credentials.
                "app_meta" => tx.execute(
                    "DELETE FROM app_meta WHERE key NOT IN (
                        'legacy_json_migrated', 'ai_schema_version', 'todo_schema_version',
                        'bt_error_payload_schema_version', 'bt_download_only_migrated_v1',
                        'model_viewer_schema_version'
                    )",
                    [],
                )?,
                _ => 0,
            };
        }
        tx.commit()?;
        Ok(changed as u32)
    }

    pub fn remove_bt_internal_data(&self) -> AppResult<()> {
        let path = self.root.join("bt");
        // librqbit 9.0.1 `Session::stop()` only pauses torrents, signals
        // cancellation and sleeps ~1s (their own source admits it is not a
        // quiescence barrier), so third-party writers may still be alive when
        // reset deletes engine data. Renaming the live directory to a
        // same-volume tombstone first detaches the name the next engine will
        // recreate: fd-holding writers can only append to the already-orphaned
        // tree, never to fresh state.
        let tombstone = self
            .root
            .join(format!("{BT_TOMBSTONE_PREFIX}{}", uuid::Uuid::new_v4()));
        if detach_bt_directory(&path, &tombstone)? {
            self.delete_bt_tombstone(&tombstone);
        }
        Ok(())
    }

    fn delete_bt_tombstone(&self, tombstone: &Path) {
        // Surviving writers may recreate files while this delete runs. A
        // residual tombstone must not fail the reset; usage accounting keeps
        // counting it and the next storage startup retries the sweep.
        if let Err(error) = fs::remove_dir_all(tombstone) {
            eprintln!("deferred bt internal data cleanup, will retry at next startup: {error}");
        }
    }

    pub(super) fn sweep_bt_tombstones(&self) {
        // Run before this process can start a fresh engine.
        let Ok(entries) = fs::read_dir(&self.root) else {
            return;
        };
        for entry in entries.flatten() {
            if entry
                .file_name()
                .to_string_lossy()
                .starts_with(BT_TOMBSTONE_PREFIX)
            {
                self.delete_bt_tombstone(&entry.path());
            }
        }
    }

    fn bt_internal_bytes(&self) -> u64 {
        let mut bytes = dir_size(&self.root.join("bt"));
        let Ok(entries) = fs::read_dir(&self.root) else {
            return bytes;
        };
        for entry in entries.flatten() {
            if entry
                .file_name()
                .to_string_lossy()
                .starts_with(BT_TOMBSTONE_PREFIX)
            {
                bytes += dir_size(&entry.path());
            }
        }
        bytes
    }

    pub fn data_clear_result(
        &self,
        module: AppDataModule,
        records_deleted: u32,
        before: u64,
        preserved: Vec<String>,
    ) -> AppDataClearResult {
        AppDataClearResult {
            module,
            records_deleted,
            bytes_freed: before.saturating_sub(self.app_data_usage().total_bytes),
            preserved,
        }
    }
}

#[cfg(test)]
#[path = "data_tests.rs"]
mod tests;
