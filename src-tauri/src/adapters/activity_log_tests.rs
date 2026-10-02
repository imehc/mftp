use super::*;
use crate::core::{execution::Executor, operations::Operations};
use crate::modules::todo::{model::TodoItemInput, TodoRepository};
use std::path::PathBuf;
use std::sync::Arc;

struct TestStorage(Storage);
impl TestStorage {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("mftp-execution-{}", uuid::Uuid::new_v4()));
        Self(Storage::new(root).unwrap())
    }
    fn executor(&self) -> Executor {
        Executor::new(
            Arc::new(StorageActivityLog(self.0.clone())),
            Arc::new(Operations::default()),
        )
    }
}
impl Drop for TestStorage {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(self.0.root_path());
    }
}

#[test]
fn todo_pipeline_writes_once_and_logs_only_explicit_metadata() {
    let fixture = TestStorage::new();
    let repository = TodoRepository::new(fixture.0.clone());
    let executor = fixture.executor();
    let item = tauri::async_runtime::block_on(executor.blocking(
        OperationContext::new("todo", "create", ""),
        move || {
            repository.create(TodoItemInput {
                title: "private title".into(),
                notes: Some("secret notes".into()),
                category: None,
                due_date: None,
                due_at: None,
                completed: false,
            })
        },
    ))
    .unwrap();
    assert_eq!(
        TodoRepository::new(fixture.0.clone()).list().unwrap()[0].id,
        item.id
    );
    let logs = fixture
        .0
        .list_activity_logs(10, Some("todo"), None)
        .unwrap();
    assert_eq!(logs.len(), 1);
    assert_eq!(logs[0].request_type, "create");
    assert_eq!(logs[0].result, "success");
    assert_eq!(logs[0].detail, None);
    assert_eq!(logs[0].error, None);
    assert!(!serde_json::to_string(&logs)
        .unwrap()
        .contains("private title"));
}

#[test]
fn sftp_mkdir_failure_keeps_original_error_and_failed_log() {
    let fixture = TestStorage::new();
    let manager = Arc::new(crate::modules::ssh::Manager::new(
        PathBuf::from(fixture.0.root_path()).join("journal.json"),
    ));
    let expected = manager.sftp_mkdir("missing", "/new-directory").unwrap_err();
    let executor = fixture.executor();
    let error = tauri::async_runtime::block_on(executor.blocking(
        OperationContext::new("sftp", "mkdir", "missing").with_detail("/new-directory".into()),
        move || manager.sftp_mkdir("missing", "/new-directory"),
    ))
    .unwrap_err();
    assert_eq!(error, expected);
    let logs = fixture
        .0
        .list_activity_logs(10, Some("sftp"), None)
        .unwrap();
    assert_eq!(logs.len(), 1);
    assert_eq!(logs[0].ip, "missing");
    assert_eq!(logs[0].request_type, "mkdir");
    assert_eq!(logs[0].result, "failed");
    // `detail` keeps the business metadata; the failure's full structured
    // error travels in the versioned payload column.
    assert_eq!(logs[0].detail.as_deref(), Some("/new-directory"));
    assert_eq!(logs[0].error.as_ref(), Some(&expected));
}
