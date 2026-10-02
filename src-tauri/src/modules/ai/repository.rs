//! AI persistence. Credential contents never enter the database or public DTOs.
use super::AiConnectionConfig;
use crate::error::{AppError, AppResult, CustomErrorCode};
use crate::storage::Storage;
#[cfg(test)]
use rusqlite::OptionalExtension;

#[derive(Clone)]
pub(crate) struct AiRepository {
    pub(super) storage: Storage,
}

pub(super) struct StoredConnection {
    pub config: Option<AiConnectionConfig>,
    pub reference: Option<String>,
    #[cfg(test)]
    pub streaming_enabled: bool,
}

impl AiRepository {
    pub(crate) fn new(storage: Storage) -> Self {
        Self { storage }
    }

    pub(super) fn selected(&self) -> AppResult<StoredConnection> {
        connection_in(&self.storage.conn()?, None)
    }

    #[cfg(test)]
    pub(crate) fn connection(&self) -> AppResult<Option<AiConnectionConfig>> {
        Ok(self.selected()?.config)
    }

    #[cfg(test)]
    pub(crate) fn save_connection(&self, config: &AiConnectionConfig) -> AppResult<()> {
        self.publish_legacy(config, None, false)
    }

    #[cfg(test)]
    pub(super) fn can_adopt_default(&self) -> AppResult<bool> {
        let conn = self.storage.conn()?;
        Ok(conn.query_row(
            "SELECT NOT EXISTS(SELECT 1 FROM ai_providers) AND NOT EXISTS(
                SELECT 1 FROM ai_credential_journal WHERE credential_ref = 'default')",
            [],
            |r| r.get(0),
        )?)
    }

    #[cfg(test)]
    pub(super) fn target_reference(&self, base_url: &str) -> AppResult<Option<String>> {
        let endpoint = super::configuration::schema::normalized_endpoint(base_url)?;
        Ok(self
            .storage
            .conn()?
            .query_row(
                "SELECT k.credential_ref FROM ai_providers p LEFT JOIN ai_provider_keys k
             ON k.provider_id = p.id AND k.id = COALESCE(p.current_key_id,
                (SELECT id FROM ai_provider_keys WHERE provider_id = p.id ORDER BY created_at, id LIMIT 1))
             WHERE p.endpoint_key = ?1",
                [endpoint],
                |r| r.get::<_, Option<String>>(0),
            )
            .optional()?
            .flatten())
    }

    pub(super) fn stage_credential(&self, reference: &str) -> AppResult<()> {
        self.storage.conn()?.execute(
            "INSERT INTO ai_credential_journal VALUES(?1, ?1, 'unpublished', ?2)",
            rusqlite::params![reference, crate::storage::now_ms()],
        )?;
        Ok(())
    }

    pub(super) fn pending_credentials(&self) -> AppResult<Vec<String>> {
        let conn = self.storage.conn()?;
        let mut stmt = conn.prepare(
            "SELECT credential_ref FROM ai_credential_journal ORDER BY created_at, credential_ref",
        )?;
        let rows = stmt
            .query_map([], |r| r.get(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub(super) fn ensure_unreferenced(&self, reference: &str) -> AppResult<()> {
        let used: bool = self.storage.conn()?.query_row(
            "SELECT EXISTS(SELECT 1 FROM ai_provider_keys WHERE credential_ref = ?1)",
            [reference],
            |r| r.get(0),
        )?;
        if used {
            return Err(AppError::external(
                "db:operation",
                "Refusing cleanup of an active AI credential",
            ));
        }
        Ok(())
    }

    pub(super) fn forget_pending(&self, reference: &str) -> AppResult<()> {
        self.storage.conn()?.execute(
            "DELETE FROM ai_credential_journal WHERE credential_ref = ?1",
            [reference],
        )?;
        Ok(())
    }

    #[cfg(test)]
    pub(super) fn clear_current_reference(&self) -> AppResult<()> {
        let mut conn = self.storage.conn()?;
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let current: Option<(String, String, Option<String>)> = tx.query_row(
            "SELECT p.id, k.id, k.credential_ref FROM ai_settings s JOIN ai_providers p ON s.active_provider_id = p.id
             JOIN ai_provider_keys k ON p.current_key_id = k.id AND p.id = k.provider_id WHERE s.id = 1",
            [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).optional()?;
        if let Some((provider, key, reference)) = current {
            if let Some(reference) = reference {
                tx.execute(
                    "INSERT INTO ai_credential_journal VALUES(?1, ?2, 'retired', ?3)",
                    rusqlite::params![
                        reference,
                        uuid::Uuid::new_v4().to_string(),
                        crate::storage::now_ms()
                    ],
                )?;
            }
            tx.execute(
                "UPDATE ai_provider_keys SET credential_ref = NULL, updated_at = ?2 WHERE id = ?1",
                rusqlite::params![key, crate::storage::now_ms()],
            )?;
            tx.execute(
                "UPDATE ai_providers SET revision = revision + 1 WHERE id = ?1",
                [provider],
            )?;
            tx.execute(
                "UPDATE ai_settings SET revision = revision + 1 WHERE id = 1",
                [],
            )?;
        }
        // Clearing the old empty configuration must also retire an orphan account.
        tx.execute(
            "INSERT OR IGNORE INTO ai_credential_journal
            SELECT 'default', ?1, 'retired', ?2 WHERE NOT EXISTS(SELECT 1 FROM ai_providers)",
            rusqlite::params![uuid::Uuid::new_v4().to_string(), crate::storage::now_ms()],
        )?;
        tx.commit()?;
        Ok(())
    }
}

#[cfg(test)]
#[path = "repository_tests.rs"]
mod tests;

// One projection supplies both active and explicitly targeted request snapshots.
pub(super) fn connection_in(
    conn: &rusqlite::Connection,
    provider_id: Option<&str>,
) -> AppResult<StoredConnection> {
    conn.query_row(
            "SELECT p.id, p.base_url, m.model_id, k.credential_ref, s.streaming_enabled
             FROM ai_settings s LEFT JOIN ai_providers p ON p.id = COALESCE(?1, s.active_provider_id)
             LEFT JOIN ai_provider_models m ON m.id = p.current_model_id AND m.provider_id = p.id
             LEFT JOIN ai_provider_keys k ON k.id = p.current_key_id AND k.provider_id = p.id WHERE s.id = 1",
            [provider_id], |r| Ok((r.get::<_, Option<String>>(0)?, r.get::<_, Option<String>>(1)?,
                r.get::<_, Option<String>>(2)?, r.get::<_, Option<String>>(3)?, r.get::<_, i64>(4)? != 0)),
        ).map_err(AppError::from).and_then(|(id, base, model, reference, streaming_enabled)| {
            let config = if id.is_some() {
                Some(AiConnectionConfig {
                    base_url: base.ok_or_else(|| AppError::custom(CustomErrorCode::AiAddressInvalid))?,
                    model: model.ok_or_else(|| AppError::custom(CustomErrorCode::AiModelInvalid))?,
                    streaming_enabled,
                })
            } else { None };
            Ok(StoredConnection { config, reference, #[cfg(test)] streaming_enabled })
        })
}

impl StoredConnection {
    pub(super) fn validated(self) -> AppResult<(AiConnectionConfig, String)> {
        let config = self
            .config
            .ok_or_else(|| AppError::custom(CustomErrorCode::AiConnectionNotConfigured))?;
        let mut validated =
            super::service::url::validate_connection(&config.base_url, &config.model)?;
        validated.streaming_enabled = config.streaming_enabled;
        let reference = self
            .reference
            .ok_or_else(|| AppError::custom(CustomErrorCode::AiApiKeyMissing))?;
        Ok((validated, reference))
    }
}
