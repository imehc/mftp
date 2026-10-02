use super::*;

struct TestDir(PathBuf);
impl TestDir {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("bt-files-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap();
        Self(path)
    }
}
impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn task(root: &Path) -> BtTaskRow {
    BtTaskRow {
        info_hash: "a".repeat(40),
        label: "test".into(),
        dest_dir: String::new(),
        mode: "download".into(),
        pinned: false,
        created_at: 0,
        work_dir: root.to_string_lossy().into_owned(),
        file_indices: vec![0, 1],
        package_mode: "archive".into(),
        status: "active".into(),
        output_path: None,
        export_path: None,
        total_bytes: Some(100),
        error: None,
    }
}

#[test]
fn browse_nested_original_files_in_active_and_completed_tasks() {
    let dir = TestDir::new();
    std::fs::create_dir(dir.0.join("album")).unwrap();
    std::fs::write(dir.0.join("album/歌曲.mp3"), b"original").unwrap();
    std::fs::write(dir.0.join("readme.txt"), b"text").unwrap();
    let mut row = task(&dir.0);
    row.output_path = Some(dir.0.join("packed.tar").to_string_lossy().into_owned());
    std::fs::write(dir.0.join("packed.tar"), b"archive").unwrap();
    std::fs::write(dir.0.join(".packed.mftp-part"), b"partial").unwrap();
    for status in ["active", "completed"] {
        row.status = status.into();
        let listing = list_path(&row, "").unwrap();
        assert_eq!(listing.entries.len(), 2);
        assert!(listing.entries[0].is_dir);
        let album = list_path(&row, "album").unwrap();
        assert_eq!(album.entries[0].path, "album/歌曲.mp3");
        let file = list_path(&row, "album/歌曲.mp3").unwrap();
        assert!(!file.current.is_dir);
        assert_eq!(file.current.size, 8);
    }
    assert_eq!(
        std::fs::read(dir.0.join("album/歌曲.mp3")).unwrap(),
        b"original"
    );
}

#[test]
fn rejects_traversal_absolute_paths_and_windows_separators() {
    let dir = TestDir::new();
    for path in [
        "../outside",
        "/etc/passwd",
        "album/../../outside",
        "..\\outside",
        "C:\\secret",
    ] {
        let error = resolve_path(&dir.0, path).unwrap_err();
        assert_eq!(error.kind, crate::error::AppErrorKind::Custom);
        assert_eq!(error.code, "bt:file_not_in_task");
    }
    assert_eq!(
        resolve_path(&dir.0, "").unwrap(),
        dir.0.canonicalize().unwrap()
    );
}

#[cfg(unix)]
#[test]
fn refuses_symlinks_in_browsing_and_read_paths() {
    let dir = TestDir::new();
    let outside = TestDir::new();
    std::fs::write(outside.0.join("secret.txt"), b"secret").unwrap();
    std::os::unix::fs::symlink(&outside.0, dir.0.join("escape")).unwrap();
    std::os::unix::fs::symlink(outside.0.join("secret.txt"), dir.0.join("file.txt")).unwrap();
    assert!(list_path(&task(&dir.0), "").unwrap().entries.is_empty());
    assert!(resolve_path(&dir.0, "escape/secret.txt").is_err());
    assert!(resolve_path(&dir.0, "file.txt").is_err());
}

#[test]
fn missing_file_keeps_external_io_category() {
    let dir = TestDir::new();
    let error = list_path(&task(&dir.0), "missing.txt").unwrap_err();
    assert_eq!(error.kind, crate::error::AppErrorKind::External);
    assert_eq!(error.code, "io:not_found");
}

struct RecordingFiles {
    opened: std::sync::Mutex<Vec<PathBuf>>,
    failure: std::sync::Mutex<Option<AppError>>,
}

impl crate::modules::bt::ports::FileAccess for RecordingFiles {
    fn download_dir(&self) -> AppResult<PathBuf> {
        Err(AppError::external(
            "opener:directory",
            "Unavailable in this test",
        ))
    }

    fn open(&self, path: &Path) -> AppResult<()> {
        self.opened.lock().unwrap().push(path.to_owned());
        match self.failure.lock().unwrap().clone() {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }
}

#[tokio::test]
async fn open_passes_only_validated_original_paths_and_preserves_adapter_errors() {
    use crate::modules::bt::repository::BtRepository;
    use std::sync::{Arc, Mutex};

    let dir = TestDir::new();
    let download = dir.0.join("download");
    std::fs::create_dir(&download).unwrap();
    let original = download.join("original.txt");
    std::fs::write(&original, b"unchanged").unwrap();
    let repository = BtRepository::new(crate::storage::Storage::new(dir.0.join("db")).unwrap());
    let row = task(&download);
    repository.upsert_bt_task(&row).unwrap();
    let files = Arc::new(RecordingFiles {
        opened: Mutex::new(Vec::new()),
        failure: Mutex::new(None),
    });
    let manager = BtManager::new(
        repository,
        dir.0.join("bt"),
        Arc::new(|_| {}),
        files.clone(),
    );
    for path in ["../outside.txt", "", "missing.txt"] {
        assert!(manager
            .open_file(&row.info_hash, path.into())
            .await
            .is_err());
    }
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(&original, download.join("link.txt")).unwrap();
        assert!(manager
            .open_file(&row.info_hash, "link.txt".into())
            .await
            .is_err());
    }
    assert!(files.opened.lock().unwrap().is_empty());
    manager
        .open_file(&row.info_hash, "original.txt".into())
        .await
        .unwrap();
    assert_eq!(
        *files.opened.lock().unwrap(),
        vec![original.canonicalize().unwrap()]
    );
    let failure = AppError::external("opener:open", "System application unavailable")
        .with_arg("osCode", "13");
    *files.failure.lock().unwrap() = Some(failure.clone());
    assert_eq!(
        manager
            .open_file(&row.info_hash, "original.txt".into())
            .await
            .unwrap_err(),
        failure
    );
    assert_eq!(std::fs::read(original).unwrap(), b"unchanged");
    assert!(manager.engine_running().is_none());
    assert!(!dir.0.join("bt").exists());
}
