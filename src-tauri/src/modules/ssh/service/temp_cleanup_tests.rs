use super::*;
use crate::error::{AppError, AppErrorKind, CustomErrorCode};

struct Fixture {
    root: PathBuf,
    manager: Manager,
}
impl Fixture {
    fn new() -> Self {
        let root =
            std::env::temp_dir().join(format!("mftp-attempt-cleanup-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        Self {
            manager: Manager::new(root.join("journal.json")),
            root,
        }
    }
    fn assert_drained(&self) {
        assert!(self.manager.local_temps.lock().is_empty());
        assert!(self.manager.transfers.lock().is_empty());
        assert!(!self.root.join("journal.json").exists());
        assert!(!self.root.join("journal.json.tmp").exists());
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn failed_connection_removes_download_temp_without_touching_existing_destination() {
    let fixture = Fixture::new();
    let destination = fixture.root.join("destination.bin");
    fs::write(&destination, b"original").unwrap();
    let error = fixture
        .manager
        .sftp_download(
            "missing",
            "/remote",
            destination.to_str().unwrap(),
            None,
            Some("task"),
        )
        .unwrap_err();
    assert_eq!(
        error,
        AppError::custom(CustomErrorCode::SshSessionNotFound).with_arg("sessionId", "missing")
    );
    assert_eq!(fs::read(&destination).unwrap(), b"original");
    assert_eq!(fs::read_dir(&fixture.root).unwrap().count(), 1);
    fixture.assert_drained();
}

#[test]
fn local_open_failure_preserves_the_existing_parent_and_cleans_registration() {
    let fixture = Fixture::new();
    let parent = fixture.root.join("not-a-directory");
    fs::write(&parent, b"original").unwrap();
    let destination = parent.join("destination.bin");
    let error = fixture
        .manager
        .sftp_download(
            "missing",
            "/remote",
            destination.to_str().unwrap(),
            None,
            Some("task"),
        )
        .unwrap_err();
    assert_eq!(error.kind, AppErrorKind::External);
    assert!(error.code.starts_with("io:"));
    assert_eq!(fs::read(&parent).unwrap(), b"original");
    fixture.assert_drained();
}

#[test]
fn early_cancel_cleans_created_download_file_and_transfer_guard() {
    let fixture = Fixture::new();
    fixture.manager.cancel_transfer("task");
    let destination = fixture.root.join("download.bin");
    let error = fixture
        .manager
        .sftp_download(
            "missing",
            "/remote",
            destination.to_str().unwrap(),
            None,
            Some("task"),
        )
        .unwrap_err();
    assert_eq!(
        error,
        AppError::custom(CustomErrorCode::SftpTransferCancelled)
    );
    assert_eq!(fs::read_dir(&fixture.root).unwrap().count(), 0);
    fixture.assert_drained();
}

#[test]
fn archive_preflight_failure_releases_temp_journal_and_transfer() {
    let fixture = Fixture::new();
    let error = fixture
        .manager
        .sftp_download_dir_archive(
            "missing",
            "/remote",
            fixture.root.to_str().unwrap(),
            None,
            Some("archive"),
        )
        .unwrap_err();
    assert_eq!(error.code, CustomErrorCode::SshSessionNotFound.as_str());
    assert_eq!(fs::read_dir(&fixture.root).unwrap().count(), 0);
    fixture.assert_drained();
}

#[test]
fn startup_replays_both_journals_and_is_idempotent() {
    let fixture = Fixture::new();
    let first = fixture.root.join("first.part");
    let second = fixture.root.join("second.part");
    fs::write(&first, b"partial").unwrap();
    fs::write(&second, b"partial").unwrap();
    fs::write(
        fixture.root.join("journal.json"),
        serde_json::to_vec(&vec![&first]).unwrap(),
    )
    .unwrap();
    fs::write(
        fixture.root.join("journal.json.tmp"),
        serde_json::to_vec(&vec![&second]).unwrap(),
    )
    .unwrap();
    let manager = Manager::new(fixture.root.join("journal.json"));
    assert!(manager.local_temps.lock().is_empty());
    assert!(!first.exists());
    assert!(!second.exists());
    let _manager = Manager::new(fixture.root.join("journal.json"));
    fixture.assert_drained();
}

#[cfg(unix)]
#[test]
fn failed_cleanup_keeps_journal_until_the_path_becomes_accessible() {
    use std::os::unix::fs::symlink;
    let fixture = Fixture::new();
    let cycle = fixture.root.join("cycle");
    symlink("cycle", &cycle).unwrap();
    let path = cycle.join("temp.part");
    let temp = fixture.manager.track_local_temp(path.clone()).unwrap();
    drop(temp);
    assert!(fixture.manager.cleanup_local_temps().is_err());
    assert!(fixture.manager.local_temps.lock().contains(&path));
    let journal: Vec<PathBuf> =
        serde_json::from_slice(&fs::read(fixture.root.join("journal.json")).unwrap()).unwrap();
    assert_eq!(journal, vec![path.clone()]);
    // A subsequent startup still retains the failed path.
    let manager = Manager::new(fixture.root.join("journal.json"));
    assert!(manager.local_temps.lock().contains(&path));
    fs::remove_file(&cycle).unwrap();
    fs::create_dir(&cycle).unwrap();
    fs::write(&path, b"leftover").unwrap();
    let manager = Manager::new(fixture.root.join("journal.json"));
    assert!(manager.local_temps.lock().is_empty());
    assert!(!path.exists());
    assert!(!fixture.root.join("journal.json").exists());
}

#[cfg(unix)]
#[test]
fn temporary_symlink_cleanup_preserves_the_user_directory() {
    use std::os::unix::fs::symlink;
    let fixture = Fixture::new();
    let user = fixture.root.join("user");
    fs::create_dir(&user).unwrap();
    fs::write(user.join("keep"), b"original").unwrap();
    let link = fixture.root.join("temp-link");
    symlink(&user, &link).unwrap();
    drop(fixture.manager.track_local_temp(link.clone()).unwrap());
    assert!(!link.exists());
    assert_eq!(fs::read(user.join("keep")).unwrap(), b"original");
    fixture.assert_drained();
}
