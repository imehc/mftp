#![expect(
    clippy::unwrap_used,
    reason = "Isolated fixtures fail immediately on invalid setup."
)]

use crate::{Database, TodoRepository, TodoView, model::TodoItemInput, schema};
use mftp_foundation::AppResult;
use rusqlite::{Connection, params};
use std::{
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};

struct Fixture {
    root: tempfile::TempDir,
    database: Arc<FileDatabase>,
    repo: TodoRepository,
}
struct FileDatabase(PathBuf);

impl Database for FileDatabase {
    fn conn(&self) -> AppResult<Connection> {
        let conn = Connection::open(&self.0)?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        Ok(conn)
    }
}

impl Fixture {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        let database = Arc::new(FileDatabase(root.path().join("todo.sqlite3")));
        schema::init(&mut database.conn().unwrap()).unwrap();
        Self {
            repo: TodoRepository::new(database.clone()),
            root,
            database,
        }
    }
}

fn input(title: &str) -> TodoItemInput {
    TodoItemInput {
        title: title.into(),
        category: None,
        notes: Some(" plain note ".into()),
        due_date: None,
        due_at: None,
        completed: false,
        priority: None,
    }
}

#[test]
fn crud_reopens_with_stable_identity_and_structured_missing_error() {
    let f = Fixture::new();
    let created = f.repo.create(input(" Plan ")).unwrap();
    assert_eq!(created.title, "Plan");
    assert_eq!(created.notes.as_deref(), Some("plain note"));
    let updated = f
        .repo
        .update_at_revision(&created.id, input("Ship"), Some(0))
        .unwrap();
    let reopened = TodoRepository::new(Arc::new(FileDatabase(f.root.path().join("todo.sqlite3"))));
    let current = reopened.get(&created.id).unwrap();
    assert_eq!(
        (
            current.item().id.clone(),
            current.item().title.clone(),
            current.revision()
        ),
        (updated.id, "Ship".into(), 1)
    );
    reopened.delete_at_revision(&created.id, Some(1)).unwrap();
    assert_eq!(
        reopened.get(&created.id).unwrap_err().code,
        "todo:item_not_found"
    );
}

#[test]
fn caller_owned_creation_identity_rejects_invalid_and_duplicate_ids() {
    let f = Fixture::new();
    assert_eq!(
        f.repo
            .create_with_id("invalid", input("Rejected"))
            .unwrap_err()
            .code,
        "io:invalid_input"
    );
    assert!(f.repo.list_view(TodoView::Active, "").unwrap().is_empty());
    let id = uuid::Uuid::new_v4().to_string();
    assert_eq!(f.repo.create_with_id(&id, input("First")).unwrap().id, id);
    assert!(f.repo.create_with_id(&id, input("Duplicate")).is_err());
    let records = f.repo.list_view(TodoView::Active, "").unwrap();
    assert_eq!(
        (
            records.len(),
            records[0].item().title.as_str(),
            records[0].revision()
        ),
        (1, "First", 0)
    );
}

#[test]
fn failed_write_rolls_back_without_notification_or_partial_state() {
    let f = Fixture::new();
    let created = f.repo.create(input("Kept")).unwrap();
    let changed = Arc::new(AtomicUsize::new(0));
    let count = changed.clone();
    let repo = TodoRepository::with_listener(
        f.database.clone(),
        Arc::new(move |_| {
            count.fetch_add(1, Ordering::SeqCst);
        }),
    );
    f.database.conn().unwrap().execute_batch("CREATE TRIGGER reject_update BEFORE UPDATE ON todo_items BEGIN SELECT RAISE(ABORT,'reject'); END;").unwrap();
    assert_eq!(
        repo.update(&created.id, input("Rejected"))
            .unwrap_err()
            .code,
        "db:sqlite"
    );
    let current = repo.get(&created.id).unwrap();
    assert_eq!(
        (
            current.item().title.clone(),
            current.revision(),
            changed.load(Ordering::SeqCst)
        ),
        ("Kept".into(), 0, 0)
    );
}

#[test]
fn listener_can_read_committed_write_and_begin_its_own_transaction() {
    let f = Fixture::new();
    let port = f.database.clone();
    let observed = Arc::new(AtomicUsize::new(0));
    let count = observed.clone();
    let repo = TodoRepository::with_listener(
        f.database.clone(),
        Arc::new(move |event| {
            let mut conn = port.conn().unwrap();
            let tx = conn
                .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
                .unwrap();
            let exists: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM todo_items WHERE id=?1)",
                    [event.item_id],
                    |row| row.get(0),
                )
                .unwrap();
            assert!(exists);
            tx.commit().unwrap();
            count.fetch_add(1, Ordering::SeqCst);
        }),
    );
    let created = repo.create(input("Committed")).unwrap();
    repo.update(&created.id, input("Observed")).unwrap();
    assert_eq!(observed.load(Ordering::SeqCst), 2);
}

#[test]
fn stale_editor_revision_cannot_overwrite_newer_metadata() {
    let f = Fixture::new();
    let created = f.repo.create(input("First")).unwrap();
    f.repo
        .update_at_revision(&created.id, input("Second"), Some(0))
        .unwrap();
    assert_eq!(
        f.repo
            .update_at_revision(&created.id, input("Stale"), Some(0))
            .unwrap_err()
            .code,
        "todo:note_conflict"
    );
    assert_eq!(
        f.repo
            .delete_at_revision(&created.id, Some(0))
            .unwrap_err()
            .code,
        "todo:note_conflict"
    );
    assert_eq!(f.repo.get(&created.id).unwrap().item().title, "Second");
}

#[test]
fn completion_time_survives_repeated_completion_and_clears_on_restore() {
    let f = Fixture::new();
    let created = f.repo.create(input("State")).unwrap();
    f.repo.set_completed(&created.id, true).unwrap();
    f.database
        .conn()
        .unwrap()
        .execute(
            "UPDATE todo_items SET completed_at=42 WHERE id=?1",
            [&created.id],
        )
        .unwrap();
    assert_eq!(
        f.repo
            .set_completed(&created.id, true)
            .unwrap()
            .completed_at,
        Some(42)
    );
    assert_eq!(
        f.repo
            .set_completed(&created.id, false)
            .unwrap()
            .completed_at,
        None
    );
    f.database
        .conn()
        .unwrap()
        .execute(
            "UPDATE todo_items SET completed=1,completed_at=NULL WHERE id=?1",
            [&created.id],
        )
        .unwrap();
    assert_eq!(
        f.repo
            .set_completed(&created.id, true)
            .unwrap()
            .completed_at,
        None
    );
}

#[test]
fn native_order_and_search_are_stable_when_an_item_is_edited() {
    let f = Fixture::new();
    let first = f.repo.create(input("First")).unwrap();
    let second = f.repo.create(input("Second")).unwrap();
    let conn = f.database.conn().unwrap();
    conn.execute(
        "UPDATE todo_items SET created_at=1 WHERE id=?1",
        [&first.id],
    )
    .unwrap();
    conn.execute(
        "UPDATE todo_items SET created_at=2 WHERE id=?1",
        [&second.id],
    )
    .unwrap();
    f.repo.update(&first.id, input("Edited")).unwrap();
    let ids: Vec<_> = f
        .repo
        .list_view(TodoView::Active, "")
        .unwrap()
        .into_iter()
        .map(|row| row.into_item().id)
        .collect();
    assert_eq!(ids, vec![first.id.clone(), second.id.clone()]);
    assert_eq!(
        f.repo.list_view(TodoView::Active, "EDITED").unwrap().len(),
        1
    );
    assert_eq!(
        f.repo
            .list_view(TodoView::Active, "plain note")
            .unwrap()
            .len(),
        2
    );
    f.repo.set_completed(&first.id, true).unwrap();
    f.repo.set_completed(&second.id, true).unwrap();
    conn.execute(
        "UPDATE todo_items SET completed_at=10 WHERE id=?1",
        [&first.id],
    )
    .unwrap();
    conn.execute(
        "UPDATE todo_items SET completed_at=20 WHERE id=?1",
        [&second.id],
    )
    .unwrap();
    let ids: Vec<_> = f
        .repo
        .list_view(TodoView::Completed, "")
        .unwrap()
        .into_iter()
        .map(|row| row.into_item().id)
        .collect();
    assert_eq!(ids, vec![second.id, first.id]);
}

#[test]
fn legacy_migration_is_idempotent_and_preserves_unknown_completion_time() {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("CREATE TABLE todo_items(id TEXT PRIMARY KEY,title TEXT NOT NULL,category TEXT,notes TEXT,due_date TEXT,completed INTEGER,created_at INTEGER,updated_at INTEGER);
        INSERT INTO todo_items VALUES('legacy','Kept',NULL,'Old note','2026-11-16',1,10,20);").unwrap();
    schema::init(&mut conn).unwrap();
    schema::init(&mut conn).unwrap();
    let kept: (i64,i64,Option<i64>,Option<i64>,i64) = conn.query_row("SELECT created_at,updated_at,due_at,completed_at,revision FROM todo_items WHERE id='legacy'", [], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?))).unwrap();
    assert_eq!(kept, (10, 20, None, None, 0));
    let version: String = conn
        .query_row(
            "SELECT value FROM app_meta WHERE key='todo_schema_version'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(version, "3");
}

#[test]
fn unknown_schema_is_rejected_without_downgrade_or_new_tables() {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("CREATE TABLE app_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL); INSERT INTO app_meta VALUES('todo_schema_version','99');").unwrap();
    assert_eq!(schema::init(&mut conn).unwrap_err().code, "io:invalid_data");
    let version: String = conn
        .query_row(
            "SELECT value FROM app_meta WHERE key='todo_schema_version'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(version, "99");
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE name LIKE 'todo_%'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 0);
}

#[test]
fn metadata_edit_preserves_rich_note_images_and_conflict_boundary() {
    let f = Fixture::new();
    let created = f.repo.create(input("Rich")).unwrap();
    let conn = f.database.conn().unwrap();
    let document = "{\"version\":1,\"blocks\":[]}";
    conn.execute("INSERT INTO todo_notes(item_id,document,first_image_id,image_count) VALUES(?1,?2,'image',1)", params![created.id,document]).unwrap();
    conn.execute("INSERT INTO todo_note_images(id,item_id,mime_type,width,height,data,thumbnail_mime,thumbnail_width,thumbnail_height,thumbnail) VALUES('image',?1,'image/png',1,1,?2,'image/jpeg',1,1,?2)", params![created.id,vec![1u8,2,3]]).unwrap();
    let metadata = TodoItemInput {
        notes: Some("plain note".into()),
        ..input("Renamed")
    };
    f.repo
        .update_at_revision(&created.id, metadata, Some(0))
        .unwrap();
    let saved: String = conn
        .query_row(
            "SELECT document FROM todo_notes WHERE item_id=?1",
            [&created.id],
            |row| row.get(0),
        )
        .unwrap();
    let bytes: Vec<u8> = conn
        .query_row(
            "SELECT data FROM todo_note_images WHERE id='image'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!((saved, bytes), (document.into(), vec![1, 2, 3]));
    assert_eq!(
        f.repo
            .update(
                &created.id,
                TodoItemInput {
                    notes: None,
                    ..input("Rejected")
                }
            )
            .unwrap_err()
            .code,
        "todo:note_conflict"
    );
    f.repo.delete_at_revision(&created.id, Some(1)).unwrap();
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM todo_note_images", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(count, 0);
}

#[test]
fn invalid_input_and_missing_writes_keep_structured_codes() {
    let f = Fixture::new();
    assert_eq!(
        f.repo.create(input("  ")).unwrap_err().code,
        "todo:title_required"
    );
    assert_eq!(
        f.repo
            .create(TodoItemInput {
                due_date: Some("2026-02-29".into()),
                ..input("Date")
            })
            .unwrap_err()
            .code,
        "todo:due_date_invalid"
    );
    assert_eq!(
        f.repo
            .create(TodoItemInput {
                due_at: Some(-1),
                ..input("Time")
            })
            .unwrap_err()
            .code,
        "todo:due_time_invalid"
    );
    assert_eq!(
        f.repo.update("missing", input("Missing")).unwrap_err().code,
        "todo:item_not_found"
    );
    assert_eq!(
        f.repo.set_completed("missing", true).unwrap_err().code,
        "todo:item_not_found"
    );
    assert_eq!(
        f.repo.delete("missing").unwrap_err().code,
        "todo:item_not_found"
    );
    assert!(f.repo.list().unwrap().is_empty());
}
