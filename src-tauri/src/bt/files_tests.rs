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
        last_error: None,
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
        assert!(resolve_path(&dir.0, path).is_err(), "{path}");
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
