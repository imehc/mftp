//! Todo-owned table definitions.

use crate::error::{AppError, AppResult};
use crate::storage::add_column_if_missing;
use rusqlite::{Connection, OptionalExtension, TransactionBehavior};

pub(crate) fn init(conn: &mut Connection) -> AppResult<()> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let version: Option<String> = tx
        .query_row(
            "SELECT value FROM app_meta WHERE key = 'todo_schema_version'",
            [],
            |row| row.get(0),
        )
        .optional()?;
    if version.as_deref().is_some_and(|value| value != "1") {
        return Err(AppError::from(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "Unsupported todo schema version",
        )));
    }
    tx.execute_batch(
        r#"
            CREATE TABLE IF NOT EXISTS todo_items (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                category TEXT,
                notes TEXT,
                due_date TEXT,
                completed INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_todo_items_list
            ON todo_items(due_date, completed, updated_at DESC);
        "#,
    )?;
    if version.is_none() {
        // Date-only records and unknown historical completion times stay intact.
        add_column_if_missing(&tx, "todo_items", "due_at", "INTEGER")?;
        add_column_if_missing(&tx, "todo_items", "completed_at", "INTEGER")?;
        tx.execute(
            "INSERT INTO app_meta(key, value) VALUES('todo_schema_version', '1')",
            [],
        )?;
    }
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
#[path = "schema_tests.rs"]
mod tests;
