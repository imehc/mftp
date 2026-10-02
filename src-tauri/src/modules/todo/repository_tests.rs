use super::*;
use std::path::PathBuf;

fn temp_repo(name: &str) -> (PathBuf, TodoRepository) {
    let root = std::env::temp_dir().join(format!("mftp-todo-db-{name}-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let storage = Storage::new(root.clone()).unwrap();
    (root, TodoRepository::new(storage))
}

fn input(title: &str, due_date: Option<&str>) -> TodoItemInput {
    TodoItemInput {
        title: title.into(),
        category: Some(" work ".into()),
        notes: Some(" remember this ".into()),
        due_date: due_date.map(str::to_string),
        due_at: None,
        completed: false,
    }
}

#[test]
fn todo_crud_preserves_optional_fields_and_completion() {
    let (root, repo) = temp_repo("crud");
    let created = repo.create(input(" Plan ", None)).unwrap();
    assert_eq!(created.title, "Plan");
    assert_eq!(created.category.as_deref(), Some("work"));
    assert_eq!(created.notes.as_deref(), Some("remember this"));
    assert_eq!(created.due_date, None);
    assert!(!created.completed);

    let updated = repo
        .update(
            &created.id,
            TodoItemInput {
                title: "Ship".into(),
                category: None,
                notes: None,
                due_date: Some("2026-09-12".into()),
                due_at: None,
                completed: true,
            },
        )
        .unwrap();
    assert!(updated.completed);
    assert_eq!(updated.due_date.as_deref(), Some("2026-09-12"));

    repo.delete(&created.id).unwrap();
    assert!(repo.list().unwrap().is_empty());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn todo_list_orders_dates_then_status_and_leaves_unscheduled_last() {
    let (root, repo) = temp_repo("order");
    let later = repo.create(input("later", Some("2026-09-12"))).unwrap();
    let unscheduled = repo.create(input("none", None)).unwrap();
    let early = repo.create(input("early", Some("2026-09-11"))).unwrap();
    repo.update(
        &early.id,
        TodoItemInput {
            completed: true,
            ..input("early", Some("2026-09-11"))
        },
    )
    .unwrap();
    let open_early = repo
        .create(input("open early", Some("2026-09-11")))
        .unwrap();

    let ids = repo
        .list()
        .unwrap()
        .into_iter()
        .map(|item| item.id)
        .collect::<Vec<_>>();
    assert_eq!(ids, vec![open_early.id, early.id, later.id, unscheduled.id]);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn todo_rejects_empty_titles_and_invalid_dates() {
    let (root, repo) = temp_repo("validation");
    let title_error = repo.create(input(" ", None)).unwrap_err();
    assert_eq!(title_error.code, "todo:title_required");
    let date_error = repo
        .create(input("bad date", Some("2026-02-29")))
        .unwrap_err();
    assert_eq!(date_error.code, "todo:due_date_invalid");
    let missing_error = repo.update("missing-id", input("any", None)).unwrap_err();
    assert_eq!(missing_error.code, "todo:item_not_found");
    std::fs::remove_dir_all(root).unwrap();
}
