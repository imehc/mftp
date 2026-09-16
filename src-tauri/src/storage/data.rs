use crate::error::{AppError, AppResult};
use crate::models::{AppDataClearResult, AppDataModule, AppDataUsage};
use rusqlite::Connection;
use std::fs;
use std::path::Path;
use walkdir::WalkDir;

use super::Storage;

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
        let bt_root = self.root.join("bt");
        let bt_cache = bt_root.join("cache");
        let main_database_bytes = file_family_size(&self.db_path);
        let poetry_database_bytes = file_family_size(&poetry);
        let bt_cache_bytes = dir_size(&bt_cache);
        let bt_internal_bytes = dir_size(&bt_root);
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
                            LENGTH(CAST(COALESCE(detail, '') AS BLOB))
                        ), 0) FROM lan_access_logs",
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
            bt_cache_bytes,
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
            AppDataModule::ActivityLogs => tx.execute("DELETE FROM lan_access_logs", [])?,
            AppDataModule::Poetry | AppDataModule::BtCache => {
                return Err(AppError("module is not stored in the main database".into()));
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
            "lan_transfer_settings",
            "lan_shared_dirs",
            "lan_trusted_devices",
            "lan_access_logs",
            "vault_entries",
            "todo_items",
            "bt_tasks",
            "bt_cache_access",
            "ai_connection",
            "ai_poetry_translations",
            "app_meta",
        ];
        let mut changed = 0usize;
        for table in tables {
            changed += match table {
                "hosts" => tx.execute("DELETE FROM hosts", [])?,
                "ssh_keys" => tx.execute("DELETE FROM ssh_keys", [])?,
                "lan_transfer_settings" => tx.execute("DELETE FROM lan_transfer_settings", [])?,
                "lan_shared_dirs" => tx.execute("DELETE FROM lan_shared_dirs", [])?,
                "lan_trusted_devices" => tx.execute("DELETE FROM lan_trusted_devices", [])?,
                "lan_access_logs" => tx.execute("DELETE FROM lan_access_logs", [])?,
                "vault_entries" => tx.execute("DELETE FROM vault_entries", [])?,
                "todo_items" => tx.execute("DELETE FROM todo_items", [])?,
                "bt_tasks" => tx.execute("DELETE FROM bt_tasks", [])?,
                "bt_cache_access" => tx.execute("DELETE FROM bt_cache_access", [])?,
                "ai_connection" => tx.execute("DELETE FROM ai_connection", [])?,
                "ai_poetry_translations" => tx.execute("DELETE FROM ai_poetry_translations", [])?,
                "app_meta" => tx.execute("DELETE FROM app_meta", [])?,
                _ => 0,
            };
        }
        tx.commit()?;
        Ok(changed as u32)
    }

    pub fn remove_bt_internal_data(&self) -> AppResult<()> {
        let path = self.root.join("bt");
        if path.exists() {
            fs::remove_dir_all(path)?;
        }
        Ok(())
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
mod tests {
    use super::*;

    fn temp_root(name: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("mftp-data-{name}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn clearing_one_module_preserves_other_data() {
        let root = temp_root("module");
        let storage = Storage::new(root.clone()).unwrap();
        storage
            .conn()
            .unwrap()
            .execute("INSERT INTO todo_items(id,title,completed,created_at,updated_at) VALUES('todo','Task',0,1,1)", [])
            .unwrap();
        storage
            .conn()
            .unwrap()
            .execute("INSERT INTO vault_entries(id,title,created_at,updated_at) VALUES('vault','Entry',1,1)", [])
            .unwrap();

        assert_eq!(storage.clear_data_module(AppDataModule::Todo).unwrap(), 1);
        let conn = storage.conn().unwrap();
        let todo_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM todo_items", [], |row| row.get(0))
            .unwrap();
        let vault_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM vault_entries", [], |row| row.get(0))
            .unwrap();
        assert_eq!(todo_count, 0);
        assert_eq!(vault_count, 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reset_clears_internal_records_without_touching_external_files() {
        let root = temp_root("reset");
        let external = temp_root("external");
        let external_file = external.join("download.bin");
        fs::write(&external_file, b"keep").unwrap();
        let storage = Storage::new(root.clone()).unwrap();
        storage
            .conn()
            .unwrap()
            .execute("INSERT INTO app_meta(key,value) VALUES('test','value')", [])
            .unwrap();
        storage.reset_database().unwrap();
        assert_eq!(storage.app_data_usage().main_database_bytes > 0, true);
        assert!(external_file.exists());
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(external).unwrap();
    }
}
