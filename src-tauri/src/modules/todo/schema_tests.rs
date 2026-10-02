use super::*;
use crate::storage::Storage;

#[test]
fn legacy_todo_migration_is_idempotent_and_reset_keeps_version_after_reopen() {
    let root = std::env::temp_dir().join(format!("todo-schema-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let conn = Connection::open(root.join("mftp.sqlite3")).unwrap();
    conn.execute_batch("CREATE TABLE todo_items(id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT, notes TEXT, due_date TEXT, completed INTEGER, created_at INTEGER, updated_at INTEGER);
        INSERT INTO todo_items VALUES('legacy','Old task',NULL,NULL,'2026-09-30',1,10,20);").unwrap();
    drop(conn);
    for _ in 0..2 {
        let storage = Storage::new(root.clone()).unwrap();
        let items = super::super::repository::TodoRepository::new(storage)
            .list()
            .unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].created_at, 10);
        assert_eq!(items[0].updated_at, 20);
        assert_eq!(items[0].due_at, None);
        assert_eq!(items[0].completed_at, None);
        assert_eq!(items[0].due_date.as_deref(), Some("2026-09-30"));
    }
    Storage::new(root.clone())
        .unwrap()
        .reset_database()
        .unwrap();
    let storage = Storage::new(root.clone()).unwrap();
    assert!(
        super::super::repository::TodoRepository::new(storage.clone())
            .list()
            .unwrap()
            .is_empty()
    );
    let version: String = storage
        .conn()
        .unwrap()
        .query_row(
            "SELECT value FROM app_meta WHERE key='todo_schema_version'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(version, "1");
    std::fs::remove_dir_all(root).unwrap();
}
