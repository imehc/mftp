use super::*;
use crate::models::{ExportSection, ImportMode};

fn input(completed: bool) -> TodoItemInput {
    TodoItemInput {
        title: "Scheduled task".into(),
        category: None,
        notes: None,
        due_date: Some("2026-10-01".into()),
        due_at: Some(1_790_830_860_000),
        completed,
    }
}

#[test]
fn completion_time_tracks_transitions_without_rewriting_creation_or_edits() {
    let conn =
        Storage::new(std::env::temp_dir().join(format!("todo-times-{}", uuid::Uuid::new_v4())))
            .unwrap();
    let repo = TodoRepository::new(conn.clone());
    let original = repo.create(input(false)).unwrap();
    assert_eq!(original.completed_at, None);
    let completed = repo.update(&original.id, input(true)).unwrap();
    assert_eq!(completed.completed_at, Some(completed.updated_at));
    assert_eq!(completed.created_at, original.created_at);
    // A deterministic old value proves that an ordinary edit preserves it.
    conn.conn()
        .unwrap()
        .execute(
            "UPDATE todo_items SET completed_at = 123 WHERE id = ?1",
            [&original.id],
        )
        .unwrap();
    let edited = repo.update(&original.id, input(true)).unwrap();
    assert_eq!(edited.completed_at, Some(123));
    let reopened = repo.update(&original.id, input(false)).unwrap();
    assert_eq!(reopened.completed_at, None);
    let recompleted = repo.update(&original.id, input(true)).unwrap();
    assert_eq!(recompleted.completed_at, Some(recompleted.updated_at));
    assert_ne!(recompleted.completed_at, Some(123));
    assert_eq!(recompleted.due_at, original.due_at);
    assert!(repo
        .create(TodoItemInput {
            due_at: Some(i64::MAX),
            ..input(false)
        })
        .is_err());
    std::fs::remove_dir_all(conn.root_path()).unwrap();
}

#[test]
fn todo_time_export_import_preserves_timestamps_in_every_mode_and_legacy_data() {
    let source =
        Storage::new(std::env::temp_dir().join(format!("todo-export-{}", uuid::Uuid::new_v4())))
            .unwrap();
    let target =
        Storage::new(std::env::temp_dir().join(format!("todo-import-{}", uuid::Uuid::new_v4())))
            .unwrap();
    let original = TodoRepository::new(source.clone())
        .create(input(true))
        .unwrap();
    let raw = source
        .export_document(&[ExportSection::Todo], None)
        .unwrap();
    for mode in [ImportMode::Overwrite, ImportMode::Merge, ImportMode::Append] {
        target.import_document(&raw, None, mode).unwrap();
        let items = TodoRepository::new(target.clone()).list().unwrap();
        assert!(!items.is_empty());
        for item in items {
            assert_eq!(item.created_at, original.created_at);
            assert_eq!(item.completed_at, original.completed_at);
            assert_eq!(item.due_at, original.due_at);
        }
    }
    let mut legacy: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let mut invalid = legacy.clone();
    invalid["sections"]["todo"][0]["dueAt"] = serde_json::json!(i64::MAX);
    let before = TodoRepository::new(target.clone()).list().unwrap().len();
    assert!(target
        .import_document(&invalid.to_string(), None, ImportMode::Overwrite)
        .is_err());
    assert_eq!(
        TodoRepository::new(target.clone()).list().unwrap().len(),
        before
    );
    let rows = legacy["sections"]["todo"].as_array_mut().unwrap();
    for row in rows {
        row.as_object_mut().unwrap().remove("dueAt");
        row.as_object_mut().unwrap().remove("completedAt");
    }
    target
        .import_document(&legacy.to_string(), None, ImportMode::Overwrite)
        .unwrap();
    let item = TodoRepository::new(target.clone())
        .list()
        .unwrap()
        .remove(0);
    assert_eq!(item.due_at, None);
    assert_eq!(item.completed_at, None);
    assert_eq!(item.due_date, original.due_date);
    std::fs::remove_dir_all(source.root_path()).unwrap();
    std::fs::remove_dir_all(target.root_path()).unwrap();
}
