use super::model::{TodoItem, TodoItemInput};
use crate::error::{AppError, AppResult, CustomErrorCode};
use crate::storage::{bool_to_int, now_ms, Storage};
use rusqlite::{params, OptionalExtension, Row};

const SELECT_COLUMNS: &str =
    "id, title, category, notes, due_date, completed, created_at, updated_at, due_at, completed_at";

fn row_to_item(row: &Row) -> rusqlite::Result<TodoItem> {
    let completed: i64 = row.get(5)?;
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
    })
}

fn normalize_input(mut input: TodoItemInput) -> AppResult<TodoItemInput> {
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
    storage: Storage,
}

impl TodoRepository {
    pub(crate) fn new(storage: Storage) -> Self {
        Self { storage }
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
            created_at: now,
            updated_at: now,
        };
        let conn = self.storage.conn()?;
        conn.execute(
            r#"
            INSERT INTO todo_items(
                id, title, category, notes, due_date, completed, created_at, updated_at, due_at, completed_at
            ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
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
            ],
        )?;
        Ok(item)
    }

    pub(crate) fn update(&self, id: &str, input: TodoItemInput) -> AppResult<TodoItem> {
        let input = normalize_input(input)?;
        let conn = self.storage.conn()?;
        let changed = conn.execute(
            r#"
            UPDATE todo_items SET
                title = ?2,
                category = ?3,
                notes = ?4,
                due_date = ?5,
                completed = ?6,
                updated_at = ?7,
                due_at = ?8,
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
                input.notes,
                input.due_date,
                bool_to_int(input.completed),
                now_ms(),
                input.due_at,
            ],
        )?;
        if changed == 0 {
            return Err(AppError::custom(CustomErrorCode::TodoItemNotFound));
        }
        conn.query_row(
            &format!("SELECT {SELECT_COLUMNS} FROM todo_items WHERE id = ?1"),
            params![id],
            row_to_item,
        )
        .optional()?
        .ok_or_else(|| AppError::custom(CustomErrorCode::TodoItemNotFound))
    }

    pub(crate) fn delete(&self, id: &str) -> AppResult<()> {
        let conn = self.storage.conn()?;
        let changed = conn.execute("DELETE FROM todo_items WHERE id = ?1", params![id])?;
        if changed == 0 {
            return Err(AppError::custom(CustomErrorCode::TodoItemNotFound));
        }
        Ok(())
    }
}

#[cfg(test)]
#[path = "repository_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "time_tests.rs"]
mod time_tests;
