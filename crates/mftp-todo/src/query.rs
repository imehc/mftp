use crate::{
    TodoRepository,
    model::TodoItem,
    repository::{SELECT_COLUMNS, row_to_item},
};
use mftp_foundation::{AppError, AppResult, CustomErrorCode};
use rusqlite::OptionalExtension;

/// Shared task states use the same due and closure semantics across application adapters.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TodoView {
    Active,
    Overdue,
    Completed,
    Abandoned,
}

impl TodoView {
    pub const ALL: [Self; 4] = [
        Self::Active,
        Self::Overdue,
        Self::Completed,
        Self::Abandoned,
    ];
    pub fn index(self) -> usize {
        match self {
            Self::Active => 0,
            Self::Overdue => 1,
            Self::Completed => 2,
            Self::Abandoned => 3,
        }
    }
    pub fn key(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Overdue => "overdue",
            Self::Completed => "completed",
            Self::Abandoned => "abandoned",
        }
    }
}

/// A read snapshot carries the revision required by explicit editor writes.
#[derive(Debug, Clone)]
pub struct TodoRecord {
    item: TodoItem,
    revision: i64,
}

impl TodoRecord {
    pub fn item(&self) -> &TodoItem {
        &self.item
    }
    pub fn revision(&self) -> i64 {
        self.revision
    }
    pub fn into_item(self) -> TodoItem {
        self.item
    }
}

impl TodoRepository {
    pub fn get(&self, id: &str) -> AppResult<TodoRecord> {
        let conn = self.storage.conn()?;
        conn.query_row(
            &format!("SELECT {SELECT_COLUMNS},revision FROM todo_items WHERE id=?1"),
            [id],
            |row| {
                Ok(TodoRecord {
                    item: row_to_item(row)?,
                    revision: row.get(13)?,
                })
            },
        )
        .optional()?
        .ok_or_else(|| AppError::custom(CustomErrorCode::TodoItemNotFound))
    }

    /// Classify, filter and order a bounded database snapshot using the caller's clock.
    pub fn projection(
        &self,
        view: TodoView,
        query: &str,
        category: Option<&str>,
        priority: Option<crate::model::TodoPriority>,
        now: i64,
    ) -> AppResult<TodoProjection> {
        let conn = self.storage.conn()?;
        let mut statement =
            conn.prepare(&format!("SELECT {SELECT_COLUMNS},revision FROM todo_items"))?;
        let records = statement
            .query_map([], |row| {
                Ok(TodoRecord {
                    item: row_to_item(row)?,
                    revision: row.get(13)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(project(records, view, query, category, priority, now))
    }

    pub fn list_view(&self, view: TodoView, query: &str) -> AppResult<Vec<TodoRecord>> {
        Ok(self
            .projection(
                view,
                query,
                None,
                None,
                chrono::Utc::now().timestamp_millis(),
            )?
            .records)
    }
}

/// Counts reflect category/priority filters; search applies only to the selected view.
#[derive(Debug, Clone)]
pub struct TodoProjection {
    pub records: Vec<TodoRecord>,
    pub counts: [usize; 4],
    pub categories: Vec<String>,
}

pub fn classify(item: &TodoItem, now: i64, today: &str) -> TodoView {
    if item.abandoned {
        TodoView::Abandoned
    } else if item.completed {
        TodoView::Completed
    } else if item.due_at.is_some_and(|time| time <= now)
        || (item.due_at.is_none() && item.due_date.as_deref().is_some_and(|date| date < today))
    {
        TodoView::Overdue
    } else {
        TodoView::Active
    }
}

pub fn planned_date(item: &TodoItem) -> Option<String> {
    use chrono::TimeZone;
    item.due_at
        .and_then(|time| chrono::Local.timestamp_millis_opt(time).single())
        .map(|date| date.format("%Y-%m-%d").to_string())
        .or_else(|| item.due_date.clone())
}

pub fn closure_time(item: &TodoItem) -> Option<i64> {
    if item.abandoned {
        item.abandoned_at
    } else if item.completed {
        item.completed_at
    } else {
        None
    }
}

pub fn group_date(item: &TodoItem, view: TodoView) -> Option<String> {
    use chrono::TimeZone;
    if matches!(view, TodoView::Completed | TodoView::Abandoned) {
        closure_time(item)
            .and_then(|time| chrono::Local.timestamp_millis_opt(time).single())
            .map(|date| date.format("%Y-%m-%d").to_string())
    } else {
        planned_date(item)
    }
}

fn planned_order(left: &TodoItem, right: &TodoItem) -> std::cmp::Ordering {
    let left_date = planned_date(left);
    let right_date = planned_date(right);
    left_date
        .is_none()
        .cmp(&right_date.is_none())
        .then_with(|| left_date.cmp(&right_date))
        .then_with(|| left.due_at.unwrap_or(0).cmp(&right.due_at.unwrap_or(0)))
        .then_with(|| right.updated_at.cmp(&left.updated_at))
        .then_with(|| left.id.cmp(&right.id))
}

fn project(
    records: Vec<TodoRecord>,
    view: TodoView,
    query: &str,
    category: Option<&str>,
    priority: Option<crate::model::TodoPriority>,
    now: i64,
) -> TodoProjection {
    use chrono::TimeZone;
    let today = chrono::Local
        .timestamp_millis_opt(now)
        .single()
        .map(|date| date.format("%Y-%m-%d").to_string())
        .unwrap_or_default();
    let categories = records
        .iter()
        .filter_map(|record| record.item.category.clone())
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect();
    let query = query.trim().to_lowercase();
    let mut counts = [0; 4];
    let mut records: Vec<_> = records
        .into_iter()
        .filter(|record| {
            let item = record.item();
            if category.is_some_and(|category| item.category.as_deref() != Some(category))
                || priority.is_some_and(|priority| item.priority != Some(priority))
            {
                return false;
            }
            let current = classify(item, now, &today);
            counts[current.index()] += 1;
            current == view
                && (query.is_empty()
                    || [
                        &item.title,
                        item.notes.as_deref().unwrap_or(""),
                        item.category.as_deref().unwrap_or(""),
                    ]
                    .iter()
                    .any(|value| value.to_lowercase().contains(&query)))
        })
        .collect();
    records.sort_by(|left, right| {
        if matches!(view, TodoView::Completed | TodoView::Abandoned) {
            let a = closure_time(left.item());
            let b = closure_time(right.item());
            a.is_none()
                .cmp(&b.is_none())
                .then_with(|| b.cmp(&a))
                .then_with(|| {
                    if a.is_some() {
                        right.item.updated_at.cmp(&left.item.updated_at)
                    } else {
                        planned_order(left.item(), right.item())
                    }
                })
        } else {
            planned_order(left.item(), right.item())
        }
    });
    TodoProjection {
        records,
        counts,
        categories,
    }
}

#[cfg(test)]
#[path = "query_tests.rs"]
mod tests;
