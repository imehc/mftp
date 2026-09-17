use crate::error::{AppError, AppResult};
use crate::models::{TodoItem, TodoItemInput};
use rusqlite::{params, OptionalExtension, Row};

use super::{bool_to_int, now_ms, Storage};

const SELECT_COLUMNS: &str =
    "id, title, category, notes, due_date, completed, created_at, updated_at";

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
    })
}

fn normalize_input(mut input: TodoItemInput) -> AppResult<TodoItemInput> {
    input.title = input.title.trim().to_string();
    if input.title.is_empty() {
        return Err(AppError("todo title is required".into()));
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
        return Err(AppError("todo due date must use YYYY-MM-DD".into()));
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

impl Storage {
    pub fn list_todo_items(&self) -> AppResult<Vec<TodoItem>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {SELECT_COLUMNS} FROM todo_items
             ORDER BY due_date IS NULL ASC, due_date ASC, completed ASC, updated_at DESC"
        ))?;
        let items = stmt
            .query_map([], row_to_item)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(items)
    }

    pub fn create_todo_item(&self, input: TodoItemInput) -> AppResult<TodoItem> {
        let input = normalize_input(input)?;
        let now = now_ms();
        let item = TodoItem {
            id: uuid::Uuid::new_v4().to_string(),
            title: input.title,
            category: input.category,
            notes: input.notes,
            due_date: input.due_date,
            completed: input.completed,
            created_at: now,
            updated_at: now,
        };
        let conn = self.conn()?;
        conn.execute(
            r#"
            INSERT INTO todo_items(
                id, title, category, notes, due_date, completed, created_at, updated_at
            ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
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
            ],
        )?;
        Ok(item)
    }

    pub fn update_todo_item(&self, id: &str, input: TodoItemInput) -> AppResult<TodoItem> {
        let input = normalize_input(input)?;
        let conn = self.conn()?;
        let changed = conn.execute(
            r#"
            UPDATE todo_items SET
                title = ?2,
                category = ?3,
                notes = ?4,
                due_date = ?5,
                completed = ?6,
                updated_at = ?7
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
            ],
        )?;
        if changed == 0 {
            return Err(AppError("todo item not found".into()));
        }
        conn.query_row(
            &format!("SELECT {SELECT_COLUMNS} FROM todo_items WHERE id = ?1"),
            params![id],
            row_to_item,
        )
        .optional()?
        .ok_or_else(|| AppError("todo item not found".into()))
    }

    pub fn delete_todo_item(&self, id: &str) -> AppResult<()> {
        let conn = self.conn()?;
        let changed = conn.execute("DELETE FROM todo_items WHERE id = ?1", params![id])?;
        if changed == 0 {
            return Err(AppError("todo item not found".into()));
        }
        Ok(())
    }
}

#[cfg(test)]
#[path = "todo_tests.rs"]
mod tests;
