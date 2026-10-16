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
        priority: None,
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
                priority: None,
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

#[test]
fn todo_priority_round_trips_and_can_be_cleared() {
    let (root, repo) = temp_repo("priority");
    let created = repo
        .create(TodoItemInput {
            priority: Some(TodoPriority::High),
            ..input("priority", None)
        })
        .unwrap();
    assert_eq!(created.priority, Some(TodoPriority::High));
    assert_eq!(
        repo.list().unwrap()[0].priority,
        Some(TodoPriority::High),
        "priority must survive a select round-trip"
    );

    let cleared = repo.update(&created.id, input("priority", None)).unwrap();
    assert_eq!(cleared.priority, None);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn todo_completed_and_abandoned_are_mutually_exclusive() {
    let (root, repo) = temp_repo("exclusive");
    let created = repo.create(input("exclusive", None)).unwrap();

    let completed = repo.set_completed(&created.id, true).unwrap();
    assert!(completed.completed);
    assert!(!completed.abandoned);
    assert!(completed.completed_at.is_some());

    let abandoned = repo.set_abandoned(&created.id, true).unwrap();
    assert!(abandoned.abandoned);
    assert!(abandoned.abandoned_at.is_some());
    assert!(!abandoned.completed);
    assert_eq!(abandoned.completed_at, None);

    let restored = repo.set_abandoned(&created.id, false).unwrap();
    assert!(!restored.abandoned);
    assert_eq!(restored.abandoned_at, None);

    let completed_again = repo.set_completed(&created.id, true).unwrap();
    assert!(completed_again.completed);
    assert!(!completed_again.abandoned);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn todo_update_keeps_abandoned_state() {
    let (root, repo) = temp_repo("keep-abandoned");
    let created = repo.create(input("keep", None)).unwrap();
    repo.set_abandoned(&created.id, true).unwrap();

    let renamed = repo.update(&created.id, input("renamed", None)).unwrap();
    assert!(renamed.abandoned, "editing must not clear abandoned state");
    assert!(renamed.abandoned_at.is_some());
    std::fs::remove_dir_all(root).unwrap();
}
