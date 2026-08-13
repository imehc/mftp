struct TrackedLocalTemp<'a> {
    manager: &'a Manager,
    path: PathBuf,
}

impl Drop for TrackedLocalTemp<'_> {
    fn drop(&mut self) {
        remove_local_temp_path(&self.path);
        self.manager.untrack_local_temp(&self.path);
    }
}

fn remove_local_temp_path(path: &Path) {
    if path.is_dir() {
        let _ = fs::remove_dir_all(path);
    } else {
        let _ = fs::remove_file(path);
    }
}

impl Manager {
    pub fn new(local_temp_journal: PathBuf) -> Self {
        let pending_journal = local_temp_journal.with_extension("json.tmp");
        for journal in [&local_temp_journal, &pending_journal] {
            if let Ok(raw) = fs::read(journal) {
                if let Ok(paths) = serde_json::from_slice::<Vec<PathBuf>>(&raw) {
                    for path in paths {
                        remove_local_temp_path(&path);
                    }
                }
            }
            let _ = fs::remove_file(journal);
        }

        Self {
            auth: Mutex::new(HashMap::new()),
            shells: Mutex::new(HashMap::new()),
            sftp: Mutex::new(HashMap::new()),
            transfers: Arc::new(Mutex::new(HashMap::new())),
            local_temps: Mutex::new(HashSet::new()),
            local_temp_journal,
            monitor: Mutex::new(HashMap::new()),
        }
    }

    fn track_local_temp(&self, path: PathBuf) -> AppResult<TrackedLocalTemp<'_>> {
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

    pub fn cleanup_local_temps(&self) {
        let paths: Vec<PathBuf> = self.local_temps.lock().drain().collect();
        for path in paths {
            remove_local_temp_path(&path);
        }
        let _ = fs::remove_file(&self.local_temp_journal);
    }
}
