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
    if version
        .as_deref()
        .is_some_and(|value| !matches!(value, "1" | "2"))
    {
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
    if version.as_deref() != Some("2") {
        add_column_if_missing(&tx, "todo_items", "revision", "INTEGER NOT NULL DEFAULT 0")?;
        tx.execute_batch(
            "CREATE TABLE IF NOT EXISTS todo_notes (
                item_id TEXT PRIMARY KEY REFERENCES todo_items(id) ON DELETE CASCADE,
                document TEXT NOT NULL,
                first_image_id TEXT,
                image_count INTEGER NOT NULL CHECK(image_count BETWEEN 0 AND 10)
            );
            CREATE TABLE IF NOT EXISTS todo_note_drafts (
                id TEXT PRIMARY KEY,
                runtime_id TEXT NOT NULL,
                item_id TEXT REFERENCES todo_items(id) ON DELETE CASCADE,
                base_revision INTEGER
            );
            CREATE TABLE IF NOT EXISTS todo_note_images (
                id TEXT PRIMARY KEY,
                item_id TEXT REFERENCES todo_items(id) ON DELETE CASCADE,
                draft_id TEXT REFERENCES todo_note_drafts(id) ON DELETE CASCADE,
                mime_type TEXT NOT NULL CHECK(mime_type IN ('image/png','image/jpeg','image/webp')),
                width INTEGER NOT NULL CHECK(width > 0),
                height INTEGER NOT NULL CHECK(height > 0),
                data BLOB NOT NULL CHECK(LENGTH(data) BETWEEN 1 AND 500000),
                thumbnail_mime TEXT NOT NULL CHECK(thumbnail_mime IN ('image/jpeg','image/webp')),
                thumbnail_width INTEGER NOT NULL CHECK(thumbnail_width BETWEEN 1 AND 256),
                thumbnail_height INTEGER NOT NULL CHECK(thumbnail_height BETWEEN 1 AND 256),
                thumbnail BLOB NOT NULL CHECK(LENGTH(thumbnail) BETWEEN 1 AND 50000),
                CHECK((item_id IS NULL) != (draft_id IS NULL))
            );
            CREATE INDEX IF NOT EXISTS idx_todo_note_images_item ON todo_note_images(item_id);
            CREATE INDEX IF NOT EXISTS idx_todo_note_images_draft ON todo_note_images(draft_id);",
        )?;
        tx.execute(
            "UPDATE app_meta SET value='2' WHERE key='todo_schema_version'",
            [],
        )?;
    }
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
#[path = "schema_tests.rs"]
mod tests;
