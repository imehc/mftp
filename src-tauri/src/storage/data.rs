use crate::error::{AppError, AppResult, CustomErrorCode};
use crate::models::AppDataModule;
use std::fs;
use std::path::Path;

use super::Storage;

impl Storage {
    pub fn clear_data_module(&self, module: AppDataModule) -> AppResult<u32> {
        // File-backed modules are routed by the command layer; reaching here
        // means a caller bypassed that routing.
        if matches!(
            module,
            AppDataModule::TranslationModels | AppDataModule::Cache
        ) {
            return Err(AppError::custom(
                CustomErrorCode::AppDataModuleSeparateStore,
            ));
        }
        if module == AppDataModule::ActivityLogs {
            return self.clear_activity_logs(None);
        }
        let mut conn = self.conn()?;
        let tx = conn.transaction()?;
        let changed = match module {
            AppDataModule::Vault => tx.execute("DELETE FROM vault_entries", [])?,
            AppDataModule::Hosts => {
                tx.execute("DELETE FROM hosts", [])? + tx.execute("DELETE FROM ssh_keys", [])?
            }
            AppDataModule::Todo => {
                tx.execute("DELETE FROM todo_note_drafts", [])?;
                tx.execute("DELETE FROM todo_items", [])?
            }
            AppDataModule::ActivityLogs => return self.clear_activity_logs(None),
            AppDataModule::Poetry | AppDataModule::TranslationModels | AppDataModule::Cache => {
                // The entry layer routes poetry clears to its own database and
                // file-backed modules to filesystem deletes; reaching here means
                // a caller bypassed that routing.
                return Err(AppError::custom(
                    CustomErrorCode::AppDataModuleSeparateStore,
                ));
            }
        };
        tx.commit()?;
        Ok(changed as u32)
    }

    /// Extraction leftovers only. Databases, models and downloads are never
    /// touched so a cache clear cannot cost the user a re-download.
    pub fn clear_cache(&self) -> AppResult<u32> {
        let temp = self.root.join("poetry-tmp");
        if !temp.try_exists()? {
            return Ok(0);
        }
        fs::remove_dir_all(temp)?;
        Ok(1)
    }

    pub fn clear_poetry_database(&self) -> AppResult<()> {
        let path = self.root.join("poetry.sqlite3");
        for suffix in ["", "-wal", "-shm"] {
            let target = format!("{}{}", path.display(), suffix);
            if Path::new(&target).try_exists()? {
                fs::remove_file(target)?;
            }
        }
        let temp_dir = self.root.join("poetry-tmp");
        if temp_dir.try_exists()? {
            fs::remove_dir_all(temp_dir)?;
        }
        Ok(())
    }

    #[cfg(test)]
    pub fn reset_database(&self) -> AppResult<u32> {
        let mut conn = self.conn()?;
        let tx = conn.transaction()?;
        let changed = Self::reset_database_in(&tx)?;
        tx.commit()?;
        Ok(changed)
    }

    pub(super) fn reset_database_in(tx: &rusqlite::Transaction<'_>) -> AppResult<u32> {
        let tables = [
            "hosts",
            "ssh_keys",
            "activity_logs",
            "vault_entries",
            "todo_items",
            "app_meta",
        ];
        let mut changed = 0;
        #[cfg(desktop)]
        {
            changed += tx.execute("DELETE FROM mcp_credentials", [])?;
            tx.execute(
                "UPDATE mcp_settings SET port=?1 WHERE id=1",
                [crate::modules::mcp::repository::DEFAULT_PORT],
            )?;
        }
        changed += crate::modules::lan_transfer::schema::reset(tx)?;
        changed += crate::modules::ai::schema::reset(tx)?;
        for table in tables {
            changed += match table {
                "hosts" => tx.execute("DELETE FROM hosts", [])?,
                "ssh_keys" => tx.execute("DELETE FROM ssh_keys", [])?,
                "activity_logs" => tx.execute("DELETE FROM activity_logs", [])?,
                "vault_entries" => tx.execute("DELETE FROM vault_entries", [])?,
                "todo_items" => {
                    tx.execute("DELETE FROM todo_note_drafts", [])?;
                    tx.execute("DELETE FROM todo_items", [])?
                }
                // Schema versions and retired-source markers describe the
                // retained database, not user preferences. Clearing them can
                // replay ALTER TABLE or reimport deleted legacy credentials.
                "app_meta" => tx.execute(
                    "DELETE FROM app_meta WHERE key NOT IN (
                        'legacy_json_migrated', 'ai_schema_version', 'todo_schema_version',
                        'activity_diagnostics_schema_version',
                        'activity_file_schema_version', 'mcp_schema_version'
                    )",
                    [],
                )?,
                _ => 0,
            };
        }
        Ok(changed as u32)
    }
}

#[cfg(test)]
#[path = "data_tests.rs"]
mod tests;
