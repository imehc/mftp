#![expect(
    clippy::unwrap_used,
    reason = "Worker tests use isolated data and fail invalid fixtures immediately."
)]

use super::*;
use futures::executor::block_on;
use mftp_todo::Database;
use std::time::Duration;

fn paths(root: &tempfile::TempDir) -> AppPaths {
    AppPaths {
        data_dir: root.path().join("native"),
    }
}
fn input(title: &str) -> TodoItemInput {
    TodoItemInput {
        title: title.into(),
        category: None,
        notes: None,
        due_date: None,
        due_at: None,
        completed: false,
        priority: None,
    }
}

fn with_draft(draft: Draft) -> Session {
    let mut state = Session::default();
    state.draft = Some(draft);
    state
}

#[test]
fn accepted_write_survives_reply_drop_shutdown_and_reopen() {
    let root = tempfile::tempdir().unwrap();
    let paths = paths(&root);
    let (worker, ready) = TodoWorker::start(paths.clone()).unwrap();
    block_on(ready).unwrap();
    let client = worker.client();
    drop(client.create(input("Persisted")).unwrap());
    worker.shutdown().unwrap();
    assert_eq!(
        client.create(input("Late")).err().unwrap().code,
        "app:shutting_down"
    );
    let (reopened, ready) = TodoWorker::start(paths).unwrap();
    block_on(ready).unwrap();
    let records = block_on(
        reopened
            .client()
            .list(TodoView::Active, String::new())
            .unwrap(),
    )
    .unwrap();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].item().title, "Persisted");
    reopened.shutdown().unwrap();
}

#[test]
fn bounded_queue_rejects_extra_work_without_blocking_admission() {
    let root = tempfile::tempdir().unwrap();
    let (worker, ready) = TodoWorker::start(paths(&root)).unwrap();
    block_on(ready).unwrap();
    let client = worker.client();
    let (entered, enter) = mpsc::channel();
    let (release, wait) = mpsc::channel();
    let running = client
        .submit(move |_| {
            entered.send(()).unwrap();
            wait.recv_timeout(Duration::from_secs(5)).unwrap();
            Ok(())
        })
        .unwrap();
    enter.recv_timeout(Duration::from_secs(5)).unwrap();
    let queued: Vec<_> = (0..QUEUE_CAPACITY)
        .map(|_| client.submit(|_| Ok(())).unwrap())
        .collect();
    let extra = client.submit(|_| Ok(()));
    release.send(()).unwrap();
    assert_eq!(extra.err().unwrap().code, "todo:worker_busy");
    block_on(running).unwrap();
    worker.shutdown().unwrap();
    for reply in queued {
        block_on(reply).unwrap();
    }
}

#[test]
fn failed_initialization_remains_an_error_and_preserves_existing_bytes() {
    let root = tempfile::tempdir().unwrap();
    let paths = paths(&root);
    std::fs::create_dir_all(&paths.data_dir).unwrap();
    let db = paths.data_dir.join("mftp-native.sqlite3");
    let original = b"existing invalid database";
    std::fs::write(&db, original).unwrap();
    let (worker, ready) = TodoWorker::start(paths).unwrap();
    let initialization = block_on(ready).unwrap_err();
    let list = block_on(
        worker
            .client()
            .list(TodoView::Active, String::new())
            .unwrap(),
    )
    .unwrap_err();
    assert_eq!(initialization, list);
    assert!(worker.shutdown().is_err());
    assert_eq!(std::fs::read(db).unwrap(), original);
}

#[test]
fn reopened_connections_keep_wal_normal_and_foreign_keys() {
    let root = tempfile::tempdir().unwrap();
    let database = TodoDatabase::open(&paths(&root)).unwrap();
    for _ in 0..2 {
        let conn = database.conn().unwrap();
        let journal: String = conn
            .pragma_query_value(None, "journal_mode", |row| row.get(0))
            .unwrap();
        let synchronous: i64 = conn
            .pragma_query_value(None, "synchronous", |row| row.get(0))
            .unwrap();
        let foreign_keys: i64 = conn
            .pragma_query_value(None, "foreign_keys", |row| row.get(0))
            .unwrap();
        assert_eq!((journal.as_str(), synchronous, foreign_keys), ("wal", 1, 1));
    }
}

#[test]
fn native_database_only_contains_todo_tables_and_private_file() {
    let root = tempfile::tempdir().unwrap();
    let paths = paths(&root);
    let database = TodoDatabase::open(&paths).unwrap();
    let conn = database.conn().unwrap();
    let tables: Vec<String> = conn
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(
        tables,
        vec![
            "app_meta",
            "native_note_images",
            "native_rich_text_notes",
            "todo_items",
            "todo_note_drafts",
            "todo_note_images",
            "todo_notes"
        ]
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(paths.data_dir.join("mftp-native.sqlite3"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
}

#[test]
fn revision_conflict_retains_user_data_across_worker_tasks() {
    let root = tempfile::tempdir().unwrap();
    let (worker, ready) = TodoWorker::start(paths(&root)).unwrap();
    block_on(ready).unwrap();
    let client = worker.client();
    let created = block_on(client.create(input("First")).unwrap()).unwrap();
    block_on(
        client
            .update(created.id.clone(), input("Second"), 0)
            .unwrap(),
    )
    .unwrap();
    let conflict = block_on(
        client
            .update(created.id.clone(), input("Stale"), 0)
            .unwrap(),
    )
    .unwrap_err();
    assert_eq!(conflict.code, "todo:note_conflict");
    let current = block_on(client.get(created.id.clone()).unwrap()).unwrap();
    assert_eq!(
        (current.item().title.clone(), current.revision()),
        ("Second".into(), 1)
    );
    block_on(client.set_completed(created.id.clone(), true, 1).unwrap()).unwrap();
    block_on(client.delete(created.id, 2).unwrap()).unwrap();
    worker.shutdown().unwrap();
}

#[test]
fn shutdown_flushes_the_latest_published_draft_without_a_timer_or_job() {
    let root = tempfile::tempdir().unwrap();
    let paths = paths(&root);
    let (worker, ready) = TodoWorker::start(paths.clone()).unwrap();
    block_on(ready).unwrap();
    let client = worker.client();
    let mut draft = Draft::new();
    draft.title = "Latest input 中文".into();
    let state = with_draft(draft);
    client.publish_session(state).unwrap();
    worker.shutdown().unwrap();
    let (reopened, ready) = TodoWorker::start(paths).unwrap();
    block_on(ready).unwrap();
    assert_eq!(
        block_on(reopened.client().load_session().unwrap())
            .unwrap()
            .draft
            .unwrap()
            .title,
        "Latest input 中文"
    );
    reopened.shutdown().unwrap();
}

#[test]
fn committed_draft_survives_a_dropped_reply_and_is_never_replayed() {
    let root = tempfile::tempdir().unwrap();
    let paths = paths(&root);
    let (worker, ready) = TodoWorker::start(paths.clone()).unwrap();
    block_on(ready).unwrap();
    let client = worker.client();
    let mut draft = Draft::new();
    draft.title = "Committed once".into();
    client.publish_session(with_draft(draft.clone())).unwrap();
    drop(client.commit_draft(draft.clone()).unwrap());
    worker.shutdown().unwrap();
    let (reopened, ready) = TodoWorker::start(paths.clone()).unwrap();
    block_on(ready).unwrap();
    assert!(
        block_on(reopened.client().load_session().unwrap())
            .unwrap()
            .draft
            .is_none()
    );
    assert_eq!(
        block_on(
            reopened
                .client()
                .list(TodoView::Active, String::new())
                .unwrap()
        )
        .unwrap()
        .len(),
        1
    );
    reopened.shutdown().unwrap();

    // Model a crash after the task INSERT but before clearing the persisted creation receipt.
    let database = TodoDatabase::open(&paths).unwrap();
    session::save(&database, &with_draft(draft)).unwrap();
    let (reopened, ready) = TodoWorker::start(paths).unwrap();
    block_on(ready).unwrap();
    assert!(
        block_on(reopened.client().load_session().unwrap())
            .unwrap()
            .draft
            .is_none()
    );
    let items = block_on(
        reopened
            .client()
            .list(TodoView::Active, String::new())
            .unwrap(),
    )
    .unwrap();
    assert_eq!((items.len(), items[0].revision()), (1, 0));
    reopened.shutdown().unwrap();
}

#[test]
fn failed_creation_keeps_the_draft_and_does_not_leave_a_task() {
    let root = tempfile::tempdir().unwrap();
    let paths = paths(&root);
    let (worker, ready) = TodoWorker::start(paths.clone()).unwrap();
    block_on(ready).unwrap();
    let client = worker.client();
    let mut draft = Draft::new();
    draft.title = "Retained after failure".into();
    client.publish_session(with_draft(draft.clone())).unwrap();
    block_on(client.submit(|runtime| {
        runtime.database.conn()?.execute_batch("CREATE TRIGGER deny_create BEFORE INSERT ON todo_items BEGIN SELECT RAISE(ABORT, 'isolated write failure'); END;")?;
        Ok(())
    }).unwrap()).unwrap();
    assert!(block_on(client.commit_draft(draft).unwrap()).is_err());
    assert!(
        block_on(client.list(TodoView::Active, String::new()).unwrap())
            .unwrap()
            .is_empty()
    );
    worker.shutdown().unwrap();
    let (reopened, ready) = TodoWorker::start(paths).unwrap();
    block_on(ready).unwrap();
    assert_eq!(
        block_on(reopened.client().load_session().unwrap())
            .unwrap()
            .draft
            .unwrap()
            .title,
        "Retained after failure"
    );
    reopened.shutdown().unwrap();
}

#[test]
fn draft_revision_conflict_retains_both_the_input_and_the_committed_task() {
    let root = tempfile::tempdir().unwrap();
    let (worker, ready) = TodoWorker::start(paths(&root)).unwrap();
    block_on(ready).unwrap();
    let client = worker.client();
    let item = block_on(client.create(input("Original")).unwrap()).unwrap();
    let record = block_on(client.get(item.id.clone()).unwrap()).unwrap();
    let mut draft = Draft::edit(&record);
    draft.title = "My unsaved changes".into();
    client.publish_session(with_draft(draft.clone())).unwrap();
    block_on(
        client
            .update(item.id.clone(), input("Another writer"), 0)
            .unwrap(),
    )
    .unwrap();
    assert_eq!(
        block_on(client.commit_draft(draft).unwrap())
            .unwrap_err()
            .code,
        "todo:note_conflict"
    );
    assert_eq!(
        block_on(client.load_session().unwrap())
            .unwrap()
            .draft
            .unwrap()
            .title,
        "My unsaved changes"
    );
    assert_eq!(
        block_on(client.get(item.id).unwrap()).unwrap().item().title,
        "Another writer"
    );
    worker.shutdown().unwrap();
}

#[test]
fn persistence_failure_preserves_the_dirty_slot_and_can_be_retried() {
    let root = tempfile::tempdir().unwrap();
    let (worker, ready) = TodoWorker::start(paths(&root)).unwrap();
    block_on(ready).unwrap();
    let client = worker.client();
    block_on(client.submit(|runtime| {
        runtime.flush()?;
        runtime.database.conn()?.execute_batch("CREATE TRIGGER deny_state BEFORE UPDATE ON app_meta BEGIN SELECT RAISE(ABORT, 'isolated state failure'); END;")?;
        Ok(())
    }).unwrap()).unwrap();
    let mut draft = Draft::new();
    draft.title = "Needs retry".into();
    client.publish_session(with_draft(draft)).unwrap();
    assert!(block_on(client.persist_session().unwrap()).is_err());
    assert!(client.session.lock().unwrap().as_ref().unwrap().1);
    block_on(
        client
            .submit(|runtime| {
                runtime
                    .database
                    .conn()?
                    .execute_batch("DROP TRIGGER deny_state")?;
                Ok(())
            })
            .unwrap(),
    )
    .unwrap();
    block_on(client.persist_session().unwrap()).unwrap();
    assert!(!client.session.lock().unwrap().as_ref().unwrap().1);
    worker.shutdown().unwrap();
}
