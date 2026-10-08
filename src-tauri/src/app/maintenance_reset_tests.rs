use super::*;
use crate::models::AppDataResetStep;
use crate::modules::maintenance::{
    data::app_data_reset,
    reset::{app_data_reset_finish, app_data_reset_resume, app_data_reset_status},
};

fn seed(f: &Fixture) {
    f.storage.conn().unwrap().execute_batch("INSERT INTO todo_items(id,title,completed,created_at,updated_at) VALUES('todo','Task',0,1,1);").unwrap();
}

fn count(f: &Fixture) -> i64 {
    f.storage
        .conn()
        .unwrap()
        .query_row("SELECT COUNT(*) FROM todo_items", [], |row| row.get(0))
        .unwrap()
}

#[tokio::test]
async fn failed_bt_tombstone_deletion_is_pending_and_preserves_detached_bytes() {
    let f = Fixture::new();
    // A file at a directory location injects remove_dir_all failure on all hosts.
    std::fs::write(f.root.join("bt"), b"synthetic internal data").unwrap();
    let result = app_data_reset(f.state()).await.unwrap();
    assert_eq!(result.progress.pending, [AppDataResetStep::Bt]);
    let tombstone = std::fs::read_dir(&f.root)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .find(|path| {
            path.file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("bt.pending-delete-")
        })
        .unwrap();
    assert_eq!(
        std::fs::read(&tombstone).unwrap(),
        b"synthetic internal data"
    );
    assert!(!f.root.join("bt").exists());
    std::fs::remove_file(tombstone).unwrap();
    let result = app_data_reset_resume(f.state(), result.progress.id)
        .await
        .unwrap();
    assert!(result.progress.pending.is_empty());
}

#[tokio::test]
async fn reset_stays_exclusive_until_frontend_acknowledges_matching_operation() {
    let f = Fixture::new();
    seed(&f);
    let result = app_data_reset(f.state()).await.unwrap();
    assert!(result.failures.is_empty());
    assert!(result.progress.pending.is_empty());
    assert_eq!(count(&f), 0);
    assert!(f.storage.reset_is_pending());
    assert_eq!(
        f.operations.begin().err().unwrap().code,
        "app:reset_pending"
    );
    assert_eq!(
        app_data_reset(f.state()).await.unwrap_err().code,
        "app:reset_pending"
    );
    assert_eq!(
        app_data_reset_status(f.state()).await.unwrap(),
        Some(result.progress.clone())
    );
    assert_eq!(
        app_data_reset_finish(f.state(), "old-id".into())
            .await
            .unwrap_err()
            .code,
        "app:reset_changed"
    );
    app_data_reset_finish(f.state(), result.progress.id.clone())
        .await
        .unwrap();
    assert!(!f.storage.reset_is_pending());
    assert!(f.operations.begin().is_ok());
    assert!(app_data_reset_status(f.state()).await.unwrap().is_none());
    assert_eq!(
        app_data_reset_resume(f.state(), result.progress.id)
            .await
            .unwrap_err()
            .code,
        "app:reset_changed"
    );
}

#[tokio::test]
async fn failed_poetry_cleanup_reports_partial_commit_and_resume_does_not_reset_database_again() {
    let f = Fixture::new();
    seed(&f);
    std::fs::create_dir(f.root.join("poetry.sqlite3")).unwrap();
    std::fs::create_dir(f.root.join("bt")).unwrap();
    std::fs::write(f.root.join("bt/internal"), b"internal").unwrap();
    let external = f.root.join("user-download.bin");
    std::fs::write(&external, b"keep").unwrap();
    let result = app_data_reset(f.state()).await.unwrap();
    assert_eq!(count(&f), 0);
    assert_eq!(result.progress.pending, [AppDataResetStep::Poetry]);
    assert_eq!(result.failures.len(), 1);
    assert_eq!(result.failures[0].step, AppDataResetStep::Poetry);
    assert!(!result.failures[0].error.code.is_empty());
    assert!(!f.root.join("bt").exists());
    assert_eq!(
        app_data_reset_finish(f.state(), result.progress.id.clone())
            .await
            .unwrap_err()
            .code,
        "app:reset_incomplete"
    );
    let reopened = Storage::new(f.root.clone()).unwrap();
    assert_eq!(
        reopened.reset_progress().unwrap(),
        Some(result.progress.clone())
    );
    assert!(reopened.reset_is_pending());
    assert!(f.root.join("poetry.sqlite3").is_dir());
    std::fs::remove_dir(f.root.join("poetry.sqlite3")).unwrap();
    // Deliberately bypass admission to prove resume cannot repeat SQL reset.
    seed(&f);
    let resumed = app_data_reset_resume(f.state(), result.progress.id)
        .await
        .unwrap();
    assert!(resumed.progress.pending.is_empty());
    assert_eq!(count(&f), 1);
    assert_eq!(std::fs::read(external).unwrap(), b"keep");
}

#[tokio::test]
async fn journal_insert_failure_rolls_back_all_database_deletions() {
    let f = Fixture::new();
    seed(&f);
    f.storage.conn().unwrap().execute_batch("CREATE TRIGGER reject_reset BEFORE INSERT ON app_reset_journal BEGIN SELECT RAISE(ABORT, 'injected'); END;").unwrap();
    assert_eq!(
        app_data_reset(f.state()).await.unwrap_err().code,
        "db:sqlite"
    );
    assert_eq!(count(&f), 1);
    assert!(f.storage.reset_progress().unwrap().is_none());
    assert!(!f.storage.reset_is_pending());
    assert!(f.operations.begin().is_ok());
}

#[tokio::test]
async fn failed_checkpoint_keeps_completed_file_work_safe_to_resume() {
    let f = Fixture::new();
    std::fs::write(f.root.join("poetry.sqlite3"), b"fixture").unwrap();
    f.storage.conn().unwrap().execute_batch("CREATE TRIGGER reject_checkpoint BEFORE UPDATE ON app_reset_journal BEGIN SELECT RAISE(ABORT, 'injected'); END;").unwrap();
    let result = app_data_reset(f.state()).await.unwrap();
    assert_eq!(result.progress.pending.len(), 3);
    assert_eq!(result.failures.len(), 3);
    assert!(!f.root.join("poetry.sqlite3").exists());
    f.storage
        .conn()
        .unwrap()
        .execute_batch("DROP TRIGGER reject_checkpoint;")
        .unwrap();
    let result = app_data_reset_resume(f.state(), result.progress.id)
        .await
        .unwrap();
    assert!(result.progress.pending.is_empty());
    assert!(result.failures.is_empty());
}

#[tokio::test]
async fn credential_journal_failure_keeps_only_credentials_pending() {
    let f = Fixture::new();
    f.storage.conn().unwrap().execute_batch("CREATE TRIGGER reject_credential_cleanup BEFORE DELETE ON ai_credential_journal BEGIN SELECT RAISE(ABORT, 'injected'); END;").unwrap();
    let result = app_data_reset(f.state()).await.unwrap();
    assert_eq!(result.progress.pending, [AppDataResetStep::Credentials]);
    assert_eq!(result.failures[0].error.code, "db:sqlite");
    f.storage
        .conn()
        .unwrap()
        .execute_batch("DROP TRIGGER reject_credential_cleanup;")
        .unwrap();
    let result = app_data_reset_resume(f.state(), result.progress.id)
        .await
        .unwrap();
    assert!(result.progress.pending.is_empty());
}

#[tokio::test]
async fn dropping_reset_waiter_keeps_worker_and_maintenance_alive_through_all_phases() {
    let f = Fixture::new();
    seed(&f);
    let mut conn = f.storage.conn().unwrap();
    let lock = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .unwrap();
    let mut reset = Box::pin(app_data_reset(f.state()));
    assert!(futures_util::poll!(&mut reset).is_pending());
    drop(reset);
    assert!(!f.operations.wait_idle(Duration::ZERO));
    assert_eq!(
        f.operations.begin().err().unwrap().code,
        "app:maintenance_in_progress"
    );
    lock.commit().unwrap();
    let operations = f.operations.clone();
    assert!(crate::core::execution::run_blocking(move || Ok(
        operations.wait_idle(Duration::from_secs(4))
    ))
    .await
    .unwrap());
    assert_eq!(count(&f), 0);
    let progress = f.storage.reset_progress().unwrap().unwrap();
    assert!(progress.pending.is_empty());
    assert_eq!(
        f.operations.begin().err().unwrap().code,
        "app:reset_pending"
    );
}

#[tokio::test]
async fn corrupt_or_future_journal_never_becomes_an_absent_reset() {
    let f = Fixture::new();
    let progress = f.storage.begin_app_reset().unwrap();
    for sql in [
        "UPDATE app_reset_journal SET version = 999",
        "UPDATE app_reset_journal SET version = 1, payload = 'broken'",
    ] {
        f.storage.conn().unwrap().execute_batch(sql).unwrap();
        let reopened = Storage::new(f.root.clone()).unwrap();
        assert!(reopened.reset_is_pending());
        assert_eq!(
            reopened.reset_progress().unwrap_err().code,
            "app:reset_state_invalid"
        );
        assert_eq!(
            app_data_reset_status(f.state()).await.unwrap_err().code,
            "app:reset_state_invalid"
        );
        assert!(app_data_reset_resume(f.state(), progress.id.clone())
            .await
            .is_err());
    }
}
