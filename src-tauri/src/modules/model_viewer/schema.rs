use crate::error::{AppError, AppResult, CustomErrorCode as Code};
use rusqlite::{Connection, OptionalExtension, Transaction};

pub(crate) fn init(conn: &mut Connection) -> AppResult<()> {
    let tx = conn.transaction()?;
    let version: Option<String> = tx
        .query_row(
            "SELECT value FROM app_meta WHERE key = 'model_viewer_schema_version'",
            [],
            |row| row.get(0),
        )
        .optional()?;
    match version.as_deref() {
        None => {
            tx.execute_batch("
                CREATE TABLE model_library (
                    id TEXT PRIMARY KEY, name TEXT NOT NULL, source_name TEXT NOT NULL,
                    size INTEGER NOT NULL, favorite INTEGER NOT NULL DEFAULT 0,
                    group_name TEXT NOT NULL DEFAULT '', ready INTEGER NOT NULL DEFAULT 0,
                    view_json TEXT NOT NULL, updated_at INTEGER NOT NULL
                );
                CREATE TABLE model_resources (
                    model_id TEXT NOT NULL REFERENCES model_library(id) ON DELETE CASCADE,
                    key TEXT NOT NULL, size INTEGER NOT NULL, written INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY(model_id, key)
                );
                CREATE TABLE model_chunks (
                    model_id TEXT NOT NULL, key TEXT NOT NULL, offset INTEGER NOT NULL,
                    bytes BLOB NOT NULL, PRIMARY KEY(model_id, key, offset),
                    FOREIGN KEY(model_id, key) REFERENCES model_resources(model_id, key) ON DELETE CASCADE
                );
                CREATE TABLE model_thumbnail_cache (
                    model_id TEXT PRIMARY KEY REFERENCES model_library(id) ON DELETE CASCADE,
                    bytes BLOB NOT NULL, touched_at INTEGER NOT NULL
                );
                INSERT INTO app_meta(key, value) VALUES('model_viewer_schema_version', '1');
            ")?;
        }
        Some("1") => {}
        _ => return Err(AppError::custom(Code::ModelLibraryVersion)),
    }
    // Startup runs before workers exist. Incomplete imports never become user data.
    tx.execute("DELETE FROM model_library WHERE ready = 0", [])?;
    tx.commit()?;
    Ok(())
}

pub(crate) fn reset(tx: &Transaction<'_>) -> AppResult<usize> {
    Ok(tx.execute("DELETE FROM model_library", [])?)
}
