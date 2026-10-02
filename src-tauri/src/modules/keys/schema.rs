//! Keys-owned table definitions.

use crate::error::AppResult;
use rusqlite::Connection;

pub(crate) fn init(conn: &Connection) -> AppResult<()> {
    conn.execute(
        r#"
        CREATE TABLE IF NOT EXISTS ssh_keys (
            id TEXT PRIMARY KEY,
            label TEXT NOT NULL,
            filename TEXT NOT NULL,
            private_key TEXT NOT NULL,
            has_passphrase INTEGER NOT NULL,
            created_at INTEGER NOT NULL
        )
        "#,
        [],
    )?;
    Ok(())
}
