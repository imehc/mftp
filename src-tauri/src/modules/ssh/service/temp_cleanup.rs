use super::types::Manager;
use crate::error::AppResult;
use parking_lot::Mutex;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

pub(super) struct TrackedLocalTemp<'a> {
    manager: &'a Manager,
    path: PathBuf,
}

impl Drop for TrackedLocalTemp<'_> {
    fn drop(&mut self) {
        if remove_local_temp_path(&self.path).is_ok() {
            self.manager.untrack_local_temp(&self.path);
        }
    }
}

fn remove_local_temp_path(path: &Path) -> std::io::Result<()> {
    let result = match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_dir() => fs::remove_dir_all(path),
        Ok(_) => fs::remove_file(path),
        Err(error) => Err(error),
    };
    match result {
        // Neither a missing parent nor a non-directory parent can contain this
        // temp path. Keep other failures journaled rather than assuming absence.
        Err(error)
            if matches!(
                error.kind(),
                std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory
            ) =>
        {
            Ok(())
        }
        result => result,
    }
}

impl Manager {
    pub fn new(local_temp_journal: PathBuf) -> Self {
        let pending_journal = local_temp_journal.with_extension("json.tmp");
        let mut remaining = HashSet::new();
        for journal in [&local_temp_journal, &pending_journal] {
            if let Ok(raw) = fs::read(journal) {
                if let Ok(paths) = serde_json::from_slice::<Vec<PathBuf>>(&raw) {
                    for path in paths {
                        if remove_local_temp_path(&path).is_err() {
                            remaining.insert(path);
                        }
                    }
                }
            }
        }

        let manager = Self {
            auth: Mutex::new(HashMap::new()),
            shells: Arc::new(Mutex::new(HashMap::new())),
            operations: Arc::default(),
            workers: Arc::default(),
            sftp: Mutex::new(HashMap::new()),
            transfers: Arc::new(Mutex::new(HashMap::new())),
            local_temps: Mutex::new(remaining),
            local_temp_journal,
            monitor: Mutex::new(HashMap::new()),
        };
        let _ = manager.persist_local_temp_journal(&manager.local_temps.lock());
        manager
    }

    pub(super) fn track_local_temp(&self, path: PathBuf) -> AppResult<TrackedLocalTemp<'_>> {
        {
            let mut paths = self.local_temps.lock();
            paths.insert(path.clone());
            if let Err(error) = self.persist_local_temp_journal(&paths) {
                paths.remove(&path);
                return Err(error);
            }
        }
        Ok(TrackedLocalTemp {
            manager: self,
            path,
        })
    }

    fn untrack_local_temp(&self, path: &Path) {
        let mut paths = self.local_temps.lock();
        paths.remove(path);
        let _ = self.persist_local_temp_journal(&paths);
    }

    fn persist_local_temp_journal(&self, paths: &HashSet<PathBuf>) -> AppResult<()> {
        if paths.is_empty() {
            let _ = fs::remove_file(&self.local_temp_journal);
            let _ = fs::remove_file(self.local_temp_journal.with_extension("json.tmp"));
            return Ok(());
        }
        if let Some(parent) = self.local_temp_journal.parent() {
            fs::create_dir_all(parent)?;
        }
        let paths: Vec<&PathBuf> = paths.iter().collect();
        let pending = self.local_temp_journal.with_extension("json.tmp");
        fs::write(&pending, serde_json::to_vec(&paths)?)?;
        let _ = fs::remove_file(&self.local_temp_journal);
        fs::rename(pending, &self.local_temp_journal)?;
        Ok(())
    }

    pub(crate) fn cleanup_local_temps(&self) -> AppResult<()> {
        // Call only after shutdown drains owners, or under maintenance. Failed
        // deletions remain journaled so the next startup can retry them.
        let mut paths = self.local_temps.lock();
        let mut first_error = None;
        paths.retain(|path| match remove_local_temp_path(path) {
            Ok(()) => false,
            Err(error) => {
                first_error.get_or_insert(error);
                true
            }
        });
        let persisted = self.persist_local_temp_journal(&paths);
        if let Some(error) = first_error {
            return Err(error.into());
        }
        persisted
    }
}

#[cfg(test)]
#[path = "temp_cleanup_tests.rs"]
mod tests;
