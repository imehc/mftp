use rusqlite::{params, OptionalExtension};

use crate::ai::AiConnectionConfig;
use crate::error::AppResult;

use super::{now_ms, Storage};

pub(super) fn init_schema(conn: &rusqlite::Connection) -> AppResult<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS ai_connection (
            id INTEGER PRIMARY KEY CHECK(id = 1),
            base_url TEXT NOT NULL,
            model TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );
        "#,
    )?;
    Ok(())
}

impl Storage {
    pub fn ai_connection(&self) -> AppResult<Option<AiConnectionConfig>> {
        let conn = self.conn()?;
        conn.query_row(
            "SELECT base_url, model FROM ai_connection WHERE id = 1",
            [],
            |row| {
                Ok(AiConnectionConfig {
                    base_url: row.get(0)?,
                    model: row.get(1)?,
                })
            },
        )
        .optional()
        .map_err(Into::into)
    }

    pub fn save_ai_connection(&self, config: &AiConnectionConfig) -> AppResult<()> {
        let conn = self.conn()?;
        conn.execute(
            r#"
            INSERT INTO ai_connection(id, base_url, model, updated_at)
            VALUES(1, ?1, ?2, ?3)
            ON CONFLICT(id) DO UPDATE SET
                base_url = excluded.base_url,
                model = excluded.model,
                updated_at = excluded.updated_at
            "#,
            params![config.base_url, config.model, now_ms()],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    #[test]
    fn connection_schema_is_idempotent_and_upserts() {
        let root = std::env::temp_dir().join(format!("mftp-ai-storage-{}", uuid::Uuid::new_v4()));
        let storage = Storage::new(root.clone()).unwrap();
        let config = AiConnectionConfig {
            base_url: "https://api.example.com".into(),
            model: "model-a".into(),
        };
        storage.save_ai_connection(&config).unwrap();
        assert_eq!(storage.ai_connection().unwrap(), Some(config.clone()));

        let updated = AiConnectionConfig {
            base_url: config.base_url,
            model: "model-b".into(),
        };
        storage.save_ai_connection(&updated).unwrap();
        assert_eq!(storage.ai_connection().unwrap(), Some(updated));

        drop(storage);
        let reopened = Storage::new(root.clone()).unwrap();
        assert_eq!(reopened.ai_connection().unwrap().unwrap().model, "model-b");
        fs::remove_dir_all(root).unwrap();
    }
}
