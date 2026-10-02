use std::fs;
use std::time::{Duration, SystemTime};

pub(super) fn cleanup_stale_local_transfer_files() {
    let Ok(entries) = fs::read_dir(std::env::temp_dir()) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let is_transfer_archive = (name.starts_with("mftp-up-") || name.starts_with("mftp-dl-"))
            && name.ends_with(".tar.gz");
        let is_stale = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(|modified| SystemTime::now().duration_since(modified).ok())
            .is_some_and(|age| age >= Duration::from_secs(24 * 60 * 60));
        if is_transfer_archive && is_stale {
            let _ = fs::remove_file(entry.path());
        }
    }
}
