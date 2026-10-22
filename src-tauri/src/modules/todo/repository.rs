use super::model::{TodoItem, TodoItemInput, TodoPriority};
use crate::error::{AppError, AppResult, CustomErrorCode};
use crate::storage::{bool_to_int, now_ms, Storage};
use rusqlite::{params, OptionalExtension, Row};

pub(super) const SELECT_COLUMNS: &str =
    "id, title, category, notes, due_date, completed, created_at, updated_at, due_at, completed_at, priority, abandoned, abandoned_at";

pub(super) fn row_to_item(row: &Row) -> rusqlite::Result<TodoItem> {
    let completed: i64 = row.get(5)?;
    let abandoned: i64 = row.get(11)?;
    Ok(TodoItem {
        id: row.get(0)?,
        title: row.get(1)?,
        category: row.get(2)?,
        notes: row.get(3)?,
        due_date: row.get(4)?,
        completed: completed != 0,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
        due_at: row.get(8)?,
        completed_at: row.get(9)?,
        priority: TodoPriority::from_db(row.get(10)?),
        abandoned: abandoned != 0,
        abandoned_at: row.get(12)?,
    })
}

pub(super) fn normalize_input(mut input: TodoItemInput) -> AppResult<TodoItemInput> {
    input.title = input.title.trim().to_string();
    if input.title.is_empty() {
        return Err(AppError::custom(CustomErrorCode::TodoTitleRequired));
    }
    input.category = input
        .category
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    input.notes = input
        .notes
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    input.due_date = input
        .due_date
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if input
        .due_date
        .as_deref()
        .is_some_and(|date| !valid_date(date))
    {
        return Err(AppError::custom(CustomErrorCode::TodoDueDateInvalid));
    }
    // Keep timestamps inside the interoperable four-digit calendar range.
    if input
        .due_at
        .is_some_and(|value| !(0..=253_402_300_799_999).contains(&value))
    {
        return Err(AppError::custom(CustomErrorCode::TodoDueTimeInvalid));
    }
    Ok(input)
}

fn valid_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return false;
    }
    if bytes
        .iter()
        .enumerate()
        .any(|(index, byte)| index != 4 && index != 7 && !byte.is_ascii_digit())
    {
        return false;
    }
    let Ok(year) = value[0..4].parse::<u32>() else {
        return false;
    };
    let Ok(month) = value[5..7].parse::<u32>() else {
        return false;
    };
    let Ok(day) = value[8..10].parse::<u32>() else {
        return false;
    };
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year % 400 == 0 || (year % 4 == 0 && year % 100 != 0) => 29,
        2 => 28,
        _ => return false,
    };
    day >= 1 && day <= days
}

#[derive(Clone)]
pub(crate) struct TodoRepository {
    pub(super) storage: Storage,
    changed: Option<std::sync::Arc<dyn Fn(super::events::TodoChanged) + Send + Sync>>,
}

impl TodoRepository {
    #[cfg(test)]
    pub(crate) fn new(storage: Storage) -> Self {
        Self {
            storage,
            changed: None,
        }
    }

    pub(crate) fn with_listener(
        storage: Storage,
        changed: std::sync::Arc<dyn Fn(super::events::TodoChanged) + Send + Sync>,
    ) -> Self {
        Self {
            storage,
            changed: Some(changed),
        }
    }

    pub(super) fn notify_changed(&self, id: &str) {
        if let Some(changed) = &self.changed {
            changed(super::events::TodoChanged { item_id: id.into() });
        }
    }

    pub(crate) fn list(&self) -> AppResult<Vec<TodoItem>> {
        let conn = self.storage.conn()?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {SELECT_COLUMNS} FROM todo_items
             ORDER BY due_date IS NULL ASC, due_date ASC, completed ASC, updated_at DESC"
        ))?;
        let items = stmt
            .query_map([], row_to_item)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(items)
    }

    pub(crate) fn create(&self, input: TodoItemInput) -> AppResult<TodoItem> {
        let input = normalize_input(input)?;
        let now = now_ms();
        let item = TodoItem {
            id: uuid::Uuid::new_v4().to_string(),
            title: input.title,
            category: input.category,
            notes: input.notes,
            due_date: input.due_date,
            due_at: input.due_at,
            completed: input.completed,
            completed_at: input.completed.then_some(now),
            priority: input.priority,
            abandoned: false,
            abandoned_at: None,
            created_at: now,
            updated_at: now,
        };
        let conn = self.storage.conn()?;
        conn.execute(
            r#"
            INSERT INTO todo_items(
                id, title, category, notes, due_date, completed, created_at, updated_at, due_at, completed_at, priority
            ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
            "#,
            params![
                item.id,
                item.title,
                item.category,
                item.notes,
                item.due_date,
                bool_to_int(item.completed),
                item.created_at,
                item.updated_at,
                item.due_at,
                item.completed_at,
                item.priority.map(TodoPriority::as_str),
            ],
        )?;
        self.notify_changed(&item.id);
        Ok(item)
    }

    pub(crate) fn update(&self, id: &str, input: TodoItemInput) -> AppResult<TodoItem> {
        let requested_notes = input.notes.clone();
        let input = normalize_input(input)?;
        let mut connection = self.storage.conn()?;
        let conn =
            connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let rich_notes: Option<Option<String>> = conn.query_row(
            "SELECT t.notes FROM todo_items t JOIN todo_notes n ON n.item_id=t.id WHERE t.id=?1",
            [id], |row| row.get(0),
        ).optional()?;
        let notes = if let Some(notes) = rich_notes {
            if requested_notes != notes {
                return Err(AppError::custom(CustomErrorCode::TodoNoteConflict));
            }
            notes
        } else {
            input.notes
        };
        let changed = conn.execute(
            r#"
            UPDATE todo_items SET
                title = ?2,
                category = ?3,
                notes = ?4,
                due_date = ?5,
                completed = ?6,
                abandoned = CASE WHEN ?6 = 1 THEN 0 ELSE abandoned END,
                abandoned_at = CASE WHEN ?6 = 1 THEN NULL ELSE abandoned_at END,
                updated_at = ?7,
                revision = revision + 1,
                due_at = ?8,
                priority = ?9,
                completed_at = CASE
                    WHEN ?6 = 0 THEN NULL
                    WHEN completed = 0 THEN ?7
                    ELSE completed_at
                END
            WHERE id = ?1
            "#,
            params![
                id,
                input.title,
                input.category,
                notes,
                input.due_date,
                bool_to_int(input.completed),
                now_ms(),
                input.due_at,
                input.priority.map(TodoPriority::as_str),
            ],
        )?;
        if changed == 0 {
            return Err(AppError::custom(CustomErrorCode::TodoItemNotFound));
        }
        let item = conn
            .query_row(
                &format!("SELECT {SELECT_COLUMNS} FROM todo_items WHERE id = ?1"),
                params![id],
                row_to_item,
            )
            .optional()?
            .ok_or_else(|| AppError::custom(CustomErrorCode::TodoItemNotFound))?;
        conn.commit()?;
        self.notify_changed(id);
        Ok(item)
    }

    pub(crate) fn set_completed(&self, id: &str, completed: bool) -> AppResult<TodoItem> {
        self.set_state(id, completed, false, None)
    }

    pub(crate) fn set_abandoned(&self, id: &str, abandoned: bool) -> AppResult<TodoItem> {
        self.set_state(id, abandoned, true, None)
    }

    pub(super) fn set_state(
        &self,
        id: &str,
        value: bool,
        abandoned: bool,
        revision: Option<i64>,
    ) -> AppResult<TodoItem> {
        let mut connection = self.storage.conn()?;
        let conn =
            connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        check_expected_revision(&conn, id, revision)?;
        let (column, timestamp, other, other_timestamp) = if abandoned {
            ("abandoned", "abandoned_at", "completed", "completed_at")
        } else {
            ("completed", "completed_at", "abandoned", "abandoned_at")
        };
        let changed = conn.execute(
            &format!(
                "UPDATE todo_items SET {column}=?2,updated_at=?3,revision=revision+1,
             {timestamp}=CASE WHEN ?2=0 THEN NULL WHEN {column}=0 THEN ?3 ELSE {timestamp} END,
             {other}=CASE WHEN ?2=1 THEN 0 ELSE {other} END,
             {other_timestamp}=CASE WHEN ?2=1 THEN NULL ELSE {other_timestamp} END WHERE id=?1"
            ),
            params![id, bool_to_int(value), now_ms()],
        )?;
        if changed == 0 {
            return Err(AppError::custom(CustomErrorCode::TodoItemNotFound));
        }
        let item = conn.query_row(
            &format!("SELECT {SELECT_COLUMNS} FROM todo_items WHERE id=?1"),
            [id],
            row_to_item,
        )?;
        conn.commit()?;
        self.notify_changed(id);
        Ok(item)
    }

    pub(crate) fn delete(&self, id: &str) -> AppResult<()> {
        self.delete_at_revision(id, None)
    }

    pub(super) fn delete_at_revision(&self, id: &str, revision: Option<i64>) -> AppResult<()> {
        let mut connection = self.storage.conn()?;
        let conn =
            connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        check_expected_revision(&conn, id, revision)?;
        let changed = conn.execute("DELETE FROM todo_items WHERE id = ?1", params![id])?;
        if changed == 0 {
            return Err(AppError::custom(CustomErrorCode::TodoItemNotFound));
        }
        conn.commit()?;
        self.notify_changed(id);
        Ok(())
    }
}

pub(super) fn check_expected_revision(
    connection: &rusqlite::Connection,
    id: &str,
    revision: Option<i64>,
) -> AppResult<()> {
    if let Some(expected) = revision {
        let actual: Option<i64> = connection
            .query_row("SELECT revision FROM todo_items WHERE id=?1", [id], |row| {
                row.get(0)
            })
            .optional()?;
        let actual = actual.ok_or_else(|| AppError::custom(CustomErrorCode::TodoItemNotFound))?;
        if actual != expected || expected < 0 {
            return Err(AppError::custom(CustomErrorCode::TodoNoteConflict));
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "repository_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "time_tests.rs"]
mod time_tests;
