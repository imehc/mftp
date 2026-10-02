//! LAN-owned table definitions and reset participation.
//!
//! `activity_logs` (renamed from the historical `lan_access_logs`) stays with
//! the shared activity-log storage: despite its old name it was cross-module
//! log infrastructure, not LAN CRUD data.

use crate::error::AppResult;
use crate::storage::add_column_if_missing;
use rusqlite::{Connection, Transaction};

pub(crate) fn init(conn: &mut Connection) -> AppResult<()> {
    conn.execute_batch(
        r#"
            CREATE TABLE IF NOT EXISTS lan_transfer_settings (
                id INTEGER PRIMARY KEY CHECK(id = 1),
                device_name TEXT NOT NULL,
                port INTEGER NOT NULL,
                bind_host TEXT NOT NULL DEFAULT '',
                download_dir TEXT NOT NULL,
                auto_start INTEGER NOT NULL,
                security_mode TEXT NOT NULL,
                default_permission TEXT NOT NULL,
                max_concurrent_transfers INTEGER NOT NULL DEFAULT 3
            );

            CREATE TABLE IF NOT EXISTS lan_shared_dirs (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                path TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS lan_trusted_devices (
                id TEXT PRIMARY KEY,
                label TEXT NOT NULL,
                ip TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );

            DROP TABLE IF EXISTS lan_transfer_history;
        "#,
    )?;
    add_column_if_missing(
        conn,
        "lan_transfer_settings",
        "bind_host",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    add_column_if_missing(
        conn,
        "lan_transfer_settings",
        "max_concurrent_transfers",
        "INTEGER NOT NULL DEFAULT 3",
    )?;
    Ok(())
}

// Called inside the shared reset transaction; never commits independently.
pub(crate) fn reset(transaction: &Transaction<'_>) -> AppResult<usize> {
    let settings = transaction.execute("DELETE FROM lan_transfer_settings", [])?;
    let dirs = transaction.execute("DELETE FROM lan_shared_dirs", [])?;
    let devices = transaction.execute("DELETE FROM lan_trusted_devices", [])?;
    Ok(settings + dirs + devices)
}

#[cfg(test)]
#[path = "schema_tests.rs"]
mod tests;
