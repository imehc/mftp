use crate::error::{AppError, AppResult, CustomErrorCode};
use crate::models::AppDataModule;
use std::fs;
use std::path::Path;

use super::Storage;

// A reset detaches the live BT directory into this prefix before deleting;
// leftovers from a failed pass are swept by the next `Storage::new`.
pub(super) const BT_TOMBSTONE_PREFIX: &str = "bt.pending-delete-";

fn detach_bt_directory(path: &Path, tombstone: &Path) -> AppResult<bool> {
    // An inaccessible path is not an absent one. Never delete in place if
    // rename fails: the next engine must not reuse a tree with live writers.
    if !path.try_exists()? {
        return Ok(false);
    }
    fs::rename(path, tombstone)?;
    Ok(true)
}

impl Storage {
    pub fn clear_data_module(&self, module: AppDataModule) -> AppResult<u32> {
        // File-backed modules are routed by the command layer; reaching here
        // means a caller bypassed that routing.
        if matches!(
            module,
            AppDataModule::TranslationModels | AppDataModule::Downloads | AppDataModule::Cache
        ) {
            return Err(AppError::custom(
                CustomErrorCode::AppDataModuleSeparateStore,
            ));
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
            AppDataModule::ActivityLogs => tx.execute("DELETE FROM activity_logs", [])?,
            AppDataModule::Poetry
            | AppDataModule::TranslationModels
            | AppDataModule::Downloads
            | AppDataModule::Cache => {
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
        let mut changed = crate::modules::bt::schema::reset(tx)?;
        changed += crate::modules::lan_transfer::schema::reset(tx)?;
        changed += crate::modules::ai::schema::reset(tx)?;
        changed += crate::modules::model_viewer::schema::reset(tx)?;
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
                        'bt_error_payload_schema_version', 'bt_download_only_migrated_v1',
                        'model_viewer_schema_version', 'activity_diagnostics_schema_version'
                    )",
                    [],
                )?,
                _ => 0,
            };
        }
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
            fs::remove_dir_all(&tombstone)?;
        }
        // A previous attempt may have detached successfully before deletion
        // failed. Keep that phase pending until its detached data is gone.
        for entry in fs::read_dir(&self.root)? {
            let entry = entry?;
            if entry
                .file_name()
                .to_string_lossy()
                .starts_with(BT_TOMBSTONE_PREFIX)
            {
                fs::remove_dir_all(entry.path())?;
            }
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
}

#[cfg(test)]
#[path = "data_tests.rs"]
mod tests;
