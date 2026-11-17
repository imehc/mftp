#![expect(
    clippy::unwrap_used,
    reason = "Isolated query fixtures fail immediately."
)]
use super::*;
use crate::{
    Database,
    model::{TodoItemInput, TodoPriority},
};
use std::sync::Arc;

struct Store {
    root: tempfile::TempDir,
}
impl Database for Store {
    fn conn(&self) -> AppResult<rusqlite::Connection> {
        Ok(rusqlite::Connection::open(
            self.root.path().join("test.sqlite"),
        )?)
    }
}

fn fixture() -> TodoRepository {
    let store = Arc::new(Store {
        root: tempfile::tempdir().unwrap(),
    });
    let mut conn = store.conn().unwrap();
    crate::schema::init(&mut conn).unwrap();
    TodoRepository::new(store)
}

fn input(title: &str, date: Option<&str>, instant: Option<i64>) -> TodoItemInput {
    TodoItemInput {
        title: title.into(),
        notes: None,
        category: None,
        due_date: date.map(str::to_owned),
        due_at: instant,
        priority: None,
        completed: false,
    }
}

#[test]
fn precise_deadline_and_date_only_boundary_match_application_semantics() {
    let repo = fixture();
    let mut item = repo
        .create(input("date", Some("2026-11-16"), None))
        .unwrap();
    assert_eq!(classify(&item, 1000, "2026-11-16"), TodoView::Active);
    assert_eq!(classify(&item, 1000, "2026-11-17"), TodoView::Overdue);
    item.due_at = Some(1000);
    assert_eq!(classify(&item, 999, "2026-11-17"), TodoView::Active);
    assert_eq!(classify(&item, 1000, "2026-11-16"), TodoView::Overdue);
    item.completed = true;
    item.abandoned = true;
    assert_eq!(classify(&item, 1000, "2026-11-16"), TodoView::Abandoned);
}

#[test]
fn projection_searches_category_counts_filters_and_preserves_planned_order() {
    let repo = fixture();
    let mut first = input("date only", Some("2026-11-17"), None);
    first.category = Some("工作中文".into());
    first.priority = Some(TodoPriority::High);
    let a = repo.create(first).unwrap();
    let mut second = input("timed", Some("2026-11-17"), None);
    second.category = Some("工作中文".into());
    second.priority = Some(TodoPriority::Low);
    let b = repo.create(second).unwrap();
    repo.create(input("unplanned", None, None)).unwrap();
    repo.storage
        .conn()
        .unwrap()
        .execute("UPDATE todo_items SET updated_at=1 WHERE id=?1", [&a.id])
        .unwrap();
    repo.storage
        .conn()
        .unwrap()
        .execute("UPDATE todo_items SET updated_at=2 WHERE id=?1", [&b.id])
        .unwrap();
    let now = chrono::Local::now().timestamp_millis();
    let all = repo
        .projection(TodoView::Active, "", None, None, 0)
        .unwrap();
    assert_eq!(all.records[0].item().id, b.id);
    assert_eq!(all.records[1].item().id, a.id);
    assert_eq!(all.records[2].item().title, "unplanned");
    let filtered = repo
        .projection(
            TodoView::Active,
            "中文",
            Some("工作中文"),
            Some(TodoPriority::High),
            0,
        )
        .unwrap();
    assert_eq!(filtered.records.len(), 1);
    assert_eq!(filtered.counts, [1, 0, 0, 0]);
    assert_eq!(filtered.categories, vec!["工作中文"]);
    let searched = repo
        .projection(TodoView::Active, "not found", None, None, now)
        .unwrap();
    assert!(searched.records.is_empty());
    assert_eq!(searched.counts.iter().sum::<usize>(), 3);
}

#[test]
fn closure_sort_keeps_unknown_times_last_and_does_not_infer_updated_time() {
    let repo = fixture();
    let old = repo.create(input("legacy completion", None, None)).unwrap();
    let conn = repo.storage.conn().unwrap();
    conn.execute(
        "UPDATE todo_items SET completed=1,completed_at=NULL,updated_at=9999999999999 WHERE id=?1",
        [&old.id],
    )
    .unwrap();
    let current = repo
        .create(input("recorded completion", None, None))
        .unwrap();
    repo.set_completed(&current.id, true).unwrap();
    let records = repo.list_view(TodoView::Completed, "").unwrap();
    assert_eq!(records[0].item().id, current.id);
    assert_eq!(records[1].item().id, old.id);
    assert_eq!(group_date(records[1].item(), TodoView::Completed), None);
    repo.set_abandoned(&current.id, true).unwrap();
    assert_eq!(repo.list_view(TodoView::Completed, "").unwrap().len(), 1);
    assert_eq!(repo.list_view(TodoView::Abandoned, "").unwrap().len(), 1);
}
