//! Vault-owned table definitions, including the one-time NOT NULL relaxation
//! created by early builds that stored username/password as required columns.

use crate::error::{AppError, AppResult};
use crate::storage::add_column_if_missing;
use rusqlite::Connection;

pub(crate) fn init(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        r#"
            CREATE TABLE IF NOT EXISTS vault_entries (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                url TEXT,
                username TEXT,
                password TEXT,
                category TEXT,
                notes TEXT,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
        "#,
    )?;
    relax_vault_not_null_columns(conn)?;
    // sort_order arrived after release builds existed; the relax rebuild
    // below copies columns positionally, so this must run after it.
    add_column_if_missing(
        conn,
        "vault_entries",
        "sort_order",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_vault_entries_sort_order ON vault_entries(sort_order)",
        [],
    )?;
    Ok(())
}

/// Early builds created vault_entries with NOT NULL username/password.
/// SQLite can't drop NOT NULL in place, so rebuild the table once if needed.
fn relax_vault_not_null_columns(conn: &Connection) -> AppResult<()> {
    let needs_rebuild = {
        let mut stmt = conn.prepare("PRAGMA table_info(vault_entries)")?;
        let mut rows = stmt.query([])?;
        let mut rebuild = false;
        while let Some(row) = rows.next()? {
            let name: String = row.get(1)?;
            let notnull: i64 = row.get(3)?;
            if (name == "username" || name == "password") && notnull != 0 {
                rebuild = true;
            }
        }
        rebuild
    };
    if !needs_rebuild {
        return Ok(());
    }
    conn.execute_batch(
        r#"
        BEGIN;
        CREATE TABLE vault_entries_new (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            url TEXT,
            username TEXT,
            password TEXT,
            category TEXT,
            notes TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        INSERT INTO vault_entries_new SELECT * FROM vault_entries;
        DROP TABLE vault_entries;
        ALTER TABLE vault_entries_new RENAME TO vault_entries;
        COMMIT;
        "#,
    )
    .map_err(|error| AppError::from(error).context("failed to relax vault_entries schema"))
}
