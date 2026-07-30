use crate::error::{AppError, AppResult};
use crate::models::{VaultEntry, VaultEntryInput};
use rusqlite::{params, Connection, OptionalExtension, Row};

use super::{now_ms, Storage};

/// Early builds created vault_entries with NOT NULL username/password.
/// SQLite can't drop NOT NULL in place, so rebuild the table once if needed.
pub(super) fn relax_vault_not_null_columns(conn: &Connection) -> AppResult<()> {
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
    )?;
    Ok(())
}

fn row_to_entry(row: &Row) -> rusqlite::Result<VaultEntry> {
    Ok(VaultEntry {
        id: row.get(0)?,
        title: row.get(1)?,
        url: row.get(2)?,
        username: row.get(3)?,
        password: row.get(4)?,
        category: row.get(5)?,
        notes: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

const SELECT_COLUMNS: &str =
    "id, title, url, username, password, category, notes, created_at, updated_at";

impl Storage {
    pub fn list_vault_entries(&self) -> AppResult<Vec<VaultEntry>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {SELECT_COLUMNS} FROM vault_entries ORDER BY updated_at DESC"
        ))?;
        let rows = stmt
            .query_map([], row_to_entry)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn create_vault_entry(&self, input: VaultEntryInput) -> AppResult<VaultEntry> {
        let now = now_ms();
        let entry = VaultEntry {
            id: uuid::Uuid::new_v4().to_string(),
            title: input.title,
            url: input.url,
            username: input.username,
            password: input.password,
            category: input.category,
            notes: input.notes,
            created_at: now,
            updated_at: now,
        };
        let conn = self.conn()?;
        conn.execute(
            r#"
            INSERT INTO vault_entries(
                id, title, url, username, password, category, notes, created_at, updated_at
            ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            "#,
            params![
                entry.id,
                entry.title,
                entry.url,
                entry.username,
                entry.password,
                entry.category,
                entry.notes,
                entry.created_at,
                entry.updated_at,
            ],
        )?;
        Ok(entry)
    }

    pub fn update_vault_entry(&self, id: &str, input: VaultEntryInput) -> AppResult<VaultEntry> {
        let conn = self.conn()?;
        let updated = conn.execute(
            r#"
            UPDATE vault_entries SET
                title = ?2,
                url = ?3,
                username = ?4,
                password = ?5,
                category = ?6,
                notes = ?7,
                updated_at = ?8
            WHERE id = ?1
            "#,
            params![
                id,
                input.title,
                input.url,
                input.username,
                input.password,
                input.category,
                input.notes,
                now_ms(),
            ],
        )?;
        if updated == 0 {
            return Err(AppError("vault entry not found".into()));
        }
        conn.query_row(
            &format!("SELECT {SELECT_COLUMNS} FROM vault_entries WHERE id = ?1"),
            params![id],
            row_to_entry,
        )
        .optional()?
        .ok_or_else(|| AppError("vault entry not found".into()))
    }

    pub fn delete_vault_entry(&self, id: &str) -> AppResult<()> {
        let conn = self.conn()?;
        conn.execute("DELETE FROM vault_entries WHERE id = ?1", params![id])?;
        Ok(())
    }
}
