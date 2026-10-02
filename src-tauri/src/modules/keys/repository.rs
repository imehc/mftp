use super::model::SshKey;
use crate::error::{AppError, AppResult, CustomErrorCode};
use crate::storage::{bool_to_int, now_ms, Storage};
use rusqlite::{params, OptionalExtension, Row};
use std::fs;
use std::path::Path;

fn ssh_key_from_row(row: &Row) -> rusqlite::Result<SshKey> {
    let has_passphrase: i64 = row.get(3)?;
    Ok(SshKey {
        id: row.get(0)?,
        label: row.get(1)?,
        filename: row.get(2)?,
        has_passphrase: has_passphrase != 0,
        created_at: row.get(4)?,
    })
}

#[derive(Clone)]
pub(crate) struct KeyRepository {
    storage: Storage,
}

impl KeyRepository {
    pub(crate) fn new(storage: Storage) -> Self {
        Self { storage }
    }

    pub(crate) fn list(&self) -> AppResult<Vec<SshKey>> {
        let conn = self.storage.conn()?;
        let mut stmt = conn.prepare(
            r#"
            SELECT id, label, filename, has_passphrase, created_at
            FROM ssh_keys
            ORDER BY created_at ASC
            "#,
        )?;
        let keys = stmt
            .query_map([], ssh_key_from_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(keys)
    }

    pub(crate) fn private_key(&self, id: &str) -> AppResult<String> {
        let conn = self.storage.conn()?;
        conn.query_row(
            "SELECT private_key FROM ssh_keys WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| AppError::custom(CustomErrorCode::KeyNotFound).with_arg("id", id))
    }

    pub(crate) fn import(
        &self,
        label: String,
        source_path: &str,
        has_passphrase: bool,
    ) -> AppResult<SshKey> {
        let private_key = fs::read_to_string(source_path)?;
        let id = uuid::Uuid::new_v4().to_string();
        let filename = Path::new(source_path)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("id_key")
            .to_string();
        let key = SshKey {
            id,
            label,
            filename,
            has_passphrase,
            created_at: now_ms(),
        };
        let conn = self.storage.conn()?;
        conn.execute(
            r#"
            INSERT INTO ssh_keys(
                id, label, filename, private_key, has_passphrase, created_at
            )
            VALUES(?1, ?2, ?3, ?4, ?5, ?6)
            "#,
            params![
                key.id,
                key.label,
                key.filename,
                private_key,
                bool_to_int(key.has_passphrase),
                key.created_at,
            ],
        )?;
        Ok(key)
    }

    pub(crate) fn delete(&self, id: &str) -> AppResult<()> {
        let conn = self.storage.conn()?;
        conn.execute("DELETE FROM ssh_keys WHERE id = ?1", params![id])?;
        Ok(())
    }
}
