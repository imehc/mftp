use super::model::{VaultEntry, VaultEntryInput};
use crate::error::{AppError, AppResult, CustomErrorCode};
use crate::storage::{now_ms, Storage};
use rusqlite::{params, OptionalExtension, Row};

const SELECT_COLUMNS: &str =
    "id, title, url, username, password, category, notes, created_at, updated_at";

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

#[derive(Clone)]
pub(crate) struct VaultRepository {
    storage: Storage,
}

impl VaultRepository {
    pub(crate) fn new(storage: Storage) -> Self {
        Self { storage }
    }

    pub(crate) fn list(&self) -> AppResult<Vec<VaultEntry>> {
        let conn = self.storage.conn()?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {SELECT_COLUMNS} FROM vault_entries ORDER BY sort_order ASC, updated_at DESC"
        ))?;
        let rows = stmt
            .query_map([], row_to_entry)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub(crate) fn create(&self, input: VaultEntryInput) -> AppResult<VaultEntry> {
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
        let conn = self.storage.conn()?;
        // New entries go to the top, matching the list UI which prepends them.
        let sort_order: i64 = conn.query_row(
            "SELECT COALESCE(MIN(sort_order), 1) - 1 FROM vault_entries",
            [],
            |row| row.get(0),
        )?;
        conn.execute(
            r#"
            INSERT INTO vault_entries(
                id, title, url, username, password, category, notes, sort_order,
                created_at, updated_at
            ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
            "#,
            params![
                entry.id,
                entry.title,
                entry.url,
                entry.username,
                entry.password,
                entry.category,
                entry.notes,
                sort_order,
                entry.created_at,
                entry.updated_at,
            ],
        )?;
        Ok(entry)
    }

    pub(crate) fn update(&self, id: &str, input: VaultEntryInput) -> AppResult<VaultEntry> {
        let conn = self.storage.conn()?;
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
            return Err(AppError::custom(CustomErrorCode::VaultEntryNotFound));
        }
        conn.query_row(
            &format!("SELECT {SELECT_COLUMNS} FROM vault_entries WHERE id = ?1"),
            params![id],
            row_to_entry,
        )
        .optional()?
        .ok_or_else(|| AppError::custom(CustomErrorCode::VaultEntryNotFound))
    }

    pub(crate) fn reorder(&self, ordered_ids: Vec<String>) -> AppResult<Vec<VaultEntry>> {
        let mut conn = self.storage.conn()?;
        let tx = conn.transaction()?;
        for (index, id) in ordered_ids.iter().enumerate() {
            let changed = tx.execute(
                "UPDATE vault_entries SET sort_order = ?2 WHERE id = ?1",
                params![id, index as i64],
            )?;
            if changed == 0 {
                return Err(
                    AppError::custom(CustomErrorCode::VaultEntryNotFound).with_arg("id", id)
                );
            }
        }
        tx.commit()?;
        self.list()
    }

    pub(crate) fn delete(&self, id: &str) -> AppResult<()> {
        let conn = self.storage.conn()?;
        conn.execute("DELETE FROM vault_entries WHERE id = ?1", params![id])?;
        Ok(())
    }
}
