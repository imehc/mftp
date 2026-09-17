use super::*;
use std::path::PathBuf;

fn temp_root(name: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!("mftp-todo-db-{name}-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    root
}

fn input(title: &str, due_date: Option<&str>) -> TodoItemInput {
    TodoItemInput {
        title: title.into(),
        category: Some(" work ".into()),
        notes: Some(" remember this ".into()),
        due_date: due_date.map(str::to_string),
        completed: false,
    }
}

#[test]
fn todo_crud_preserves_optional_fields_and_completion() {
    let root = temp_root("crud");
    let storage = Storage::new(root.clone()).unwrap();
    let created = storage.create_todo_item(input(" Plan ", None)).unwrap();
    assert_eq!(created.title, "Plan");
    assert_eq!(created.category.as_deref(), Some("work"));
    assert_eq!(created.notes.as_deref(), Some("remember this"));
    assert_eq!(created.due_date, None);
    assert!(!created.completed);

    let updated = storage
        .update_todo_item(
            &created.id,
            TodoItemInput {
                title: "Ship".into(),
                category: None,
                notes: None,
                due_date: Some("2026-09-12".into()),
                completed: true,
            },
        )
        .unwrap();
    assert!(updated.completed);
    assert_eq!(updated.due_date.as_deref(), Some("2026-09-12"));

    storage.delete_todo_item(&created.id).unwrap();
    assert!(storage.list_todo_items().unwrap().is_empty());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn todo_list_orders_dates_then_status_and_leaves_unscheduled_last() {
    let root = temp_root("order");
    let storage = Storage::new(root.clone()).unwrap();
    let later = storage
        .create_todo_item(input("later", Some("2026-09-12")))
        .unwrap();
    let unscheduled = storage.create_todo_item(input("none", None)).unwrap();
    let early = storage
        .create_todo_item(input("early", Some("2026-09-11")))
        .unwrap();
    storage
        .update_todo_item(
            &early.id,
            TodoItemInput {
                completed: true,
                ..input("early", Some("2026-09-11"))
            },
        )
        .unwrap();
    let open_early = storage
        .create_todo_item(input("open early", Some("2026-09-11")))
        .unwrap();

    let ids = storage
        .list_todo_items()
        .unwrap()
        .into_iter()
        .map(|item| item.id)
        .collect::<Vec<_>>();
    assert_eq!(ids, vec![open_early.id, early.id, later.id, unscheduled.id]);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn todo_rejects_empty_titles_and_invalid_dates() {
    let root = temp_root("validation");
    let storage = Storage::new(root.clone()).unwrap();
    assert!(storage.create_todo_item(input(" ", None)).is_err());
    assert!(storage
        .create_todo_item(input("bad date", Some("2026-02-29")))
        .is_err());
    std::fs::remove_dir_all(root).unwrap();
}
