use crate::error::{AppError, AppResult};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

const MAX_BYTES: u64 = 64 * 1024 * 1024;
const MAX_TOTAL: u64 = 256 * 1024 * 1024;
const RETENTION: Duration = Duration::from_secs(24 * 60 * 60);

pub(super) fn export_error(code: &'static str) -> AppError {
    AppError::external(code, "Model export operation failed")
}

struct Entry {
    path: PathBuf,
    file: Option<File>,
    expected: u64,
    written: u64,
    retained: bool,
    active: bool,
    mime: String,
}

pub(crate) struct ModelExportStore {
    root: PathBuf,
    entries: Mutex<HashMap<String, Entry>>,
}

impl ModelExportStore {
    pub(crate) fn new(root: PathBuf) -> Self {
        Self {
            root,
            entries: Mutex::new(HashMap::new()),
        }
    }

    fn prepare_root(&self) -> AppResult<()> {
        fs::create_dir_all(&self.root)?;
        let meta = fs::symlink_metadata(&self.root)?;
        if !meta.is_dir() || meta.file_type().is_symlink() {
            return Err(export_error("model:export_invalid"));
        }
        Ok(())
    }

    fn sweep(&self, live: &HashMap<String, Entry>, now: SystemTime) -> AppResult<(u64, usize)> {
        let mut bytes = 0_u64;
        let mut count = 0;
        for child in fs::read_dir(&self.root)? {
            let child = child?;
            let name = child.file_name().to_string_lossy().into_owned();
            if uuid::Uuid::parse_str(&name).is_err() || !child.file_type()?.is_dir() {
                return Err(export_error("model:export_invalid"));
            }
            let meta = child.metadata()?;
            if !live.contains_key(&name)
                && now.duration_since(meta.modified()?).unwrap_or_default() >= RETENTION
            {
                // Only UUID directories created by this store are eligible; never follow links.
                fs::remove_dir_all(child.path())?;
                continue;
            }
            count += 1;
            for file in fs::read_dir(child.path())? {
                let file = file?;
                if !file.file_type()?.is_file() {
                    return Err(export_error("model:export_invalid"));
                }
                bytes = bytes.saturating_add(file.metadata()?.len());
            }
        }
        // Reserve the unwritten remainder of active uploads as well.
        bytes = bytes.saturating_add(live.values().map(|e| e.expected - e.written).sum::<u64>());
        Ok((bytes, count))
    }

    pub(crate) fn begin(&self, name: String, size: u32) -> AppResult<String> {
        let mime = match Path::new(&name).extension().and_then(|s| s.to_str()) {
            Some("png") => "image/png",
            Some("mp4") => "video/mp4",
            Some("webm") => "video/webm",
            Some("pdf") => "application/pdf",
            Some("txt" | "md") => "text/plain",
            _ => return Err(export_error("model:export_invalid")),
        };
        if name.is_empty()
            || name.len() > 240
            || name.contains(['/', '\\', ':'])
            || name.chars().any(char::is_control)
            || size == 0
            || u64::from(size) > MAX_BYTES
        {
            return Err(export_error("model:export_invalid"));
        }
        let mut entries = self.entries.lock();
        self.prepare_root()?;
        let (bytes, count) = self.sweep(&entries, SystemTime::now())?;
        if count >= 32 || bytes + u64::from(size) > MAX_TOTAL {
            return Err(export_error("model:export_capacity"));
        }
        let id = uuid::Uuid::new_v4().to_string();
        let directory = self.root.join(&id);
        fs::create_dir(&directory)?;
        let path = directory.join(name);
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let file = match options.open(&path) {
            Ok(file) => file,
            Err(error) => {
                fs::remove_dir(&directory)?;
                return Err(error.into());
            }
        };
        entries.insert(
            id.clone(),
            Entry {
                path,
                file: Some(file),
                expected: u64::from(size),
                written: 0,
                retained: false,
                active: false,
                mime: mime.into(),
            },
        );
        Ok(id)
    }

    pub(crate) fn write(&self, id: &str, offset: u32, bytes: &[u8]) -> AppResult<()> {
        let mut entries = self.entries.lock();
        let entry = entries
            .get_mut(id)
            .ok_or_else(|| export_error("model:export_invalid"))?;
        if entry.active
            || entry.retained
            || u64::from(offset) != entry.written
            || bytes.is_empty()
            || bytes.len() > 1024 * 1024
            || entry.written + bytes.len() as u64 > entry.expected
        {
            return Err(export_error("model:export_invalid"));
        }
        let file = entry
            .file
            .as_mut()
            .ok_or_else(|| export_error("model:export_invalid"))?;
        // A partial write poisons the upload: it must be closed, never retried at an old offset.
        if let Err(error) = file.write_all(bytes) {
            entry.file = None;
            return Err(error.into());
        }
        entry.written += bytes.len() as u64;
        Ok(())
    }

    pub(crate) fn prepare(&self, id: &str) -> AppResult<(PathBuf, String)> {
        let mut entries = self.entries.lock();
        let entry = entries
            .get_mut(id)
            .ok_or_else(|| export_error("model:export_invalid"))?;
        if entry.active {
            return Err(export_error("model:export_busy"));
        }
        if entry.retained || entry.written != entry.expected || entry.file.is_none() {
            return Err(export_error("model:export_invalid"));
        }
        if let Some(file) = entry.file.as_ref() {
            file.sync_all()?;
        }
        // Refresh the lease timestamp just before handing a complete file to the OS.
        File::open(
            entry
                .path
                .parent()
                .ok_or_else(|| export_error("model:export_invalid"))?,
        )?
        .set_times(fs::FileTimes::new().set_modified(SystemTime::now()))?;
        entry.file = None;
        entry.active = true;
        entry.retained = true;
        Ok((entry.path.clone(), entry.mime.clone()))
    }

    pub(crate) fn finish(&self, id: &str) {
        if let Some(entry) = self.entries.lock().get_mut(id) {
            entry.active = false;
        }
    }

    pub(crate) fn close(&self, id: &str) -> AppResult<()> {
        let mut entries = self.entries.lock();
        let Some(entry) = entries.get(id) else {
            return Ok(());
        };
        if entry.active {
            return Err(export_error("model:export_busy"));
        }
        if !entry.retained {
            fs::remove_dir_all(self.root.join(id))?;
        }
        entries.remove(id);
        Ok(())
    }
}

#[cfg(test)]
#[path = "export_store_tests.rs"]
mod tests;
