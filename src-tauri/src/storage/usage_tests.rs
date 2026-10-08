use super::*;
use crate::error::AppErrorKind;
use std::path::PathBuf;

struct Fixture {
    storage: Storage,
    root: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("mftp-usage-{}", uuid::Uuid::new_v4()));
        let storage = Storage::new(root.clone()).unwrap();
        Self { storage, root }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn empty_data_and_absent_optional_files_are_measured_as_zero() {
    let fixture = Fixture::new();
    let usage = fixture.storage.app_data_usage().unwrap();
    assert_eq!(usage.vault_bytes, 0);
    assert_eq!(usage.hosts_bytes, 0);
    assert_eq!(usage.todo_bytes, 0);
    assert_eq!(usage.activity_logs_bytes, 0);
    assert_eq!(usage.poetry_database_bytes, 0);
    assert_eq!(usage.bt_internal_bytes, 0);
    assert!(usage.main_database_bytes > 0);
    assert_eq!(usage.total_bytes, usage.main_database_bytes);
}

#[test]
fn failed_query_is_not_a_zero_measurement() {
    let fixture = Fixture::new();
    fixture
        .storage
        .conn()
        .unwrap()
        .execute_batch("DROP TABLE vault_entries")
        .unwrap();
    let error = fixture.storage.app_data_usage().unwrap_err();
    assert_eq!(error.kind, AppErrorKind::External);
    assert_eq!(error.code, "db:sqlite");
    assert!(error.args.contains_key("sourceCode"));
}

#[test]
fn missing_main_database_is_not_recreated_by_usage_read() {
    let fixture = Fixture::new();
    fs::rename(
        fixture.storage.db_path(),
        fixture.root.join("saved.sqlite3"),
    )
    .unwrap();
    assert!(fixture.storage.app_data_usage().is_err());
    assert!(!fixture.storage.db_path().exists());
    assert!(fixture.root.join("saved.sqlite3").exists());
}

#[test]
fn invalid_parent_paths_are_not_treated_as_missing_optional_files() {
    let fixture = Fixture::new();
    let parent = fixture.root.join("file");
    fs::write(&parent, b"keep").unwrap();
    assert!(file_family_size(&parent.join("database")).is_err());
    assert!(dir_size(&parent.join("directory")).is_err());
    assert_eq!(fs::read(parent).unwrap(), b"keep");
}

#[cfg(unix)]
#[test]
fn denied_directory_access_retains_the_io_error() {
    use std::os::unix::fs::PermissionsExt;
    let fixture = Fixture::new();
    let directory = fixture.root.join("bt");
    fs::create_dir(&directory).unwrap();
    fs::write(directory.join("data"), b"keep").unwrap();
    let permissions = fs::metadata(&directory).unwrap().permissions();
    fs::set_permissions(&directory, fs::Permissions::from_mode(0)).unwrap();
    let result = fixture.storage.app_data_usage();
    let denied = fs::read_dir(&directory).is_err();
    fs::set_permissions(&directory, permissions).unwrap();
    // Privileged CI users may bypass mode bits; the path-error test above is
    // unconditional and still guards against silently defaulting IO failures.
    if denied {
        assert_eq!(result.unwrap_err().code, "io:permission_denied");
    }
}

#[test]
fn post_clear_measurement_failure_does_not_change_success_or_claim_zero_bytes() {
    let fixture = Fixture::new();
    let conn = fixture.storage.conn().unwrap();
    conn.execute_batch("INSERT INTO todo_items(id,title,completed,created_at,updated_at) VALUES('todo','Task',0,1,1)").unwrap();
    let before = fixture.storage.app_data_usage();
    let changed = fixture
        .storage
        .clear_data_module(AppDataModule::Todo)
        .unwrap();
    conn.execute_batch("DROP TABLE vault_entries").unwrap();
    let result =
        fixture
            .storage
            .data_clear_result(AppDataModule::Todo, changed, before, Vec::new());
    assert_eq!(result.records_deleted, 1);
    assert_eq!(result.bytes_freed, None);
    assert_eq!(result.usage_error.as_ref().unwrap().code, "db:sqlite");
    let json = serde_json::to_value(result).unwrap();
    assert!(json["bytesFreed"].is_null());
    assert_eq!(json["usageError"]["kind"], "external");
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM todo_items", [], |row| row
            .get::<_, u32>(0))
            .unwrap(),
        0
    );
}

#[test]
fn failed_initial_measurement_remains_unknown_after_successful_clear() {
    let fixture = Fixture::new();
    let failure = AppError::external("io:permission_denied", "Synthetic denied read")
        .with_arg("operation", "usage");
    let result =
        fixture
            .storage
            .data_clear_result(AppDataModule::Todo, 0, Err(failure.clone()), Vec::new());
    assert_eq!(result.bytes_freed, None);
    assert_eq!(result.usage_error, Some(failure));
}
