//! Hosts-owned table definitions.

use crate::error::AppResult;
use rusqlite::Connection;

pub(crate) fn init(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        r#"
            CREATE TABLE IF NOT EXISTS hosts (
                id TEXT PRIMARY KEY,
                label TEXT NOT NULL,
                host TEXT NOT NULL,
                port INTEGER NOT NULL,
                username TEXT NOT NULL,
                auth_type TEXT NOT NULL,
                password TEXT,
                key_id TEXT,
                default_path TEXT,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_hosts_sort_order ON hosts(sort_order);
        "#,
    )?;
    Ok(())
}
