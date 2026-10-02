//! Database ownership is independent of platform engine support.

use crate::error::AppResult;
use crate::storage::add_column_if_missing;
use rusqlite::{Connection, Transaction};

pub(crate) fn init(conn: &mut Connection) -> AppResult<()> {
    conn.execute_batch(
        r#"
            CREATE TABLE IF NOT EXISTS bt_tasks (
                info_hash TEXT PRIMARY KEY,
                label TEXT NOT NULL,
                dest_dir TEXT NOT NULL,
                mode TEXT NOT NULL DEFAULT 'download',
                pinned INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                work_dir TEXT NOT NULL DEFAULT '',
                file_indices TEXT NOT NULL DEFAULT '[]',
                package_mode TEXT NOT NULL DEFAULT 'direct',
                status TEXT NOT NULL DEFAULT 'active',
                output_path TEXT,
                export_path TEXT,
                total_bytes INTEGER,
                last_error TEXT
            );

            CREATE TABLE IF NOT EXISTS bt_cache_access (
                info_hash TEXT PRIMARY KEY,
                last_access INTEGER NOT NULL
            );

    "#,
    )?;
    add_column_if_missing(conn, "bt_tasks", "work_dir", "TEXT NOT NULL DEFAULT ''")?;
    add_column_if_missing(
        conn,
        "bt_tasks",
        "file_indices",
        "TEXT NOT NULL DEFAULT '[]'",
    )?;
    add_column_if_missing(
        conn,
        "bt_tasks",
        "package_mode",
        "TEXT NOT NULL DEFAULT 'direct'",
    )?;
    add_column_if_missing(conn, "bt_tasks", "status", "TEXT NOT NULL DEFAULT 'active'")?;
    add_column_if_missing(conn, "bt_tasks", "output_path", "TEXT")?;
    add_column_if_missing(conn, "bt_tasks", "export_path", "TEXT")?;
    add_column_if_missing(conn, "bt_tasks", "total_bytes", "INTEGER")?;
    add_column_if_missing(conn, "bt_tasks", "last_error", "TEXT")?;
    migrate_error_payload(conn)?;
    conn.execute(
        "UPDATE bt_tasks SET work_dir = dest_dir WHERE work_dir = ''",
        [],
    )?;
    Ok(())
}

fn migrate_error_payload(conn: &mut Connection) -> AppResult<()> {
    // The column and version marker commit together; old diagnostic text stays
    // untouched. A newer version marker must survive an older app opening the DB.
    let transaction = conn.transaction()?;
    add_column_if_missing(&transaction, "bt_tasks", "error_payload", "TEXT")?;
    transaction.execute(
        "INSERT INTO app_meta(key, value) VALUES('bt_error_payload_schema_version', '1')
         ON CONFLICT(key) DO NOTHING",
        [],
    )?;
    transaction.commit()?;
    Ok(())
}

// Called inside the shared reset transaction; never commits independently.
pub(crate) fn reset(transaction: &Transaction<'_>) -> AppResult<usize> {
    let tasks = transaction.execute("DELETE FROM bt_tasks", [])?;
    let access = transaction.execute("DELETE FROM bt_cache_access", [])?;
    Ok(tasks + access)
}
