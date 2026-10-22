use super::*;
use crate::modules::ssh::service::Manager;

#[test]
fn missing_preview_token_is_reported_as_expired() {
    let manager = test_manager();
    let error = manager
        .rsync_transfer(
            "session",
            "unknown-token",
            RsyncDirection::Upload,
            "/tmp/mftp-source",
            "/remote/target",
            false,
            None,
            None,
        )
        .unwrap_err();
    assert_eq!(error.code, "rsync:preview_expired");
}

#[test]
fn preview_snapshot_mismatch_is_rejected() {
    let manager = test_manager();
    let token = manager.rsync.previews.insert(PreviewRecord {
        session_id: "session".into(),
        direction: RsyncDirection::Upload,
        local_dir: "/tmp/mftp-source".into(),
        remote_dir: "/remote/target".into(),
        delete_extraneous: false,
        created_at: std::time::Instant::now(),
    });
    let error = manager
        .rsync_transfer(
            "session",
            &token,
            RsyncDirection::Upload,
            "/tmp/mftp-source",
            "/remote/target",
            true,
            None,
            None,
        )
        .unwrap_err();
    assert_eq!(error.code, "rsync:preview_mismatch");
}

#[test]
fn upload_source_must_be_a_directory() {
    let root = test_root();
    let file = root.join("file.txt");
    std::fs::write(&file, b"content").expect("test file");
    let error = validate_local_target(RsyncDirection::Upload, path_str(&file)).unwrap_err();
    assert_eq!(error.code, "rsync:target_invalid");
    assert!(validate_local_target(RsyncDirection::Upload, path_str(&root)).is_ok());
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn download_target_rejects_symlinks_and_missing_parents() {
    let root = test_root();
    let real = root.join("real");
    std::fs::create_dir_all(&real).expect("real dir");
    let link = root.join("link");
    std::os::unix::fs::symlink(&real, &link).expect("target symlink");
    let error = validate_local_target(RsyncDirection::Download, path_str(&link)).unwrap_err();
    assert_eq!(error.code, "rsync:target_invalid");

    let missing = root.join("missing-target");
    assert!(validate_local_target(RsyncDirection::Download, path_str(&missing)).is_ok());

    let orphan = root.join("absent-parent/target");
    let error = validate_local_target(RsyncDirection::Download, path_str(&orphan)).unwrap_err();
    assert_eq!(error.code, "rsync:target_invalid");
    let _ = std::fs::remove_dir_all(root);
}

fn test_manager() -> Manager {
    Manager::new(
        std::env::temp_dir().join(format!("mftp-rsync-sync-{}.json", uuid::Uuid::new_v4())),
    )
}

fn test_root() -> PathBuf {
    let root = std::env::temp_dir().join(format!("mftp-rsync-sync-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).expect("test root");
    root
}

fn path_str(path: &Path) -> &str {
    path.to_str().expect("utf-8 test path")
}
