//! Compatibility writes target the address explicitly submitted by the old UI.
use super::schema::normalized_endpoint;
use crate::error::{AppError, AppResult, CustomErrorCode};
use crate::modules::ai::{AiConnectionConfig, AiRepository};
use crate::storage::now_ms;
use rusqlite::{params, OptionalExtension, Transaction, TransactionBehavior};

impl AiRepository {
    pub(in crate::modules::ai) fn publish_legacy(
        &self,
        config: &AiConnectionConfig,
        replacement: Option<&str>,
        adopt_default: bool,
    ) -> AppResult<()> {
        let endpoint = normalized_endpoint(&config.base_url)?;
        let mut conn = self.storage.conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let existing: Option<String> = tx
            .query_row(
                "SELECT id FROM ai_providers WHERE endpoint_key = ?1",
                [&endpoint],
                |r| r.get(0),
            )
            .optional()?;
        let provider = match existing {
            Some(id) => id,
            None => {
                let count: i64 =
                    tx.query_row("SELECT COUNT(*) FROM ai_providers", [], |r| r.get(0))?;
                if count >= super::validation::PROVIDER_LIMIT {
                    return Err(AppError::custom(CustomErrorCode::AiProviderLimit));
                }
                // An explicit first replacement also retires any orphan legacy account.
                // Queue this in publication so a failed save still leaves it available.
                if count == 0 && replacement.is_some() {
                    tx.execute("INSERT OR IGNORE INTO ai_credential_journal VALUES('default', ?1, 'retired', ?2)",
                        params![uuid::Uuid::new_v4().to_string(), now_ms()])?;
                }
                let id = uuid::Uuid::new_v4().to_string();
                tx.execute("INSERT INTO ai_providers(id, name, base_url, endpoint_key, created_at, updated_at) VALUES(?1, ?2, ?2, ?3, ?4, ?4)",
                    params![id, config.base_url, endpoint, now_ms()])?;
                id
            }
        };
        let model = select_model(&tx, &provider, &config.model)?;
        let (key, previous) = select_key(&tx, &provider)?;
        let reference = replacement
            .map(str::to_string)
            .or_else(|| previous.clone())
            .or_else(|| adopt_default.then(|| "default".into()));
        if let Some(new_ref) = replacement {
            let staged: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM ai_credential_journal WHERE credential_ref = ?1 AND phase = 'unpublished')", [new_ref], |r| r.get(0))?;
            if !staged {
                return Err(AppError::external(
                    "db:operation",
                    "AI credential publication has no preparation record",
                ));
            }
            if let Some(old) = previous.filter(|old| old != new_ref) {
                tx.execute(
                    "INSERT INTO ai_credential_journal VALUES(?1, ?2, 'retired', ?3)",
                    params![old, new_ref, now_ms()],
                )?;
            }
            tx.execute(
                "DELETE FROM ai_credential_journal WHERE credential_ref = ?1",
                [new_ref],
            )?;
        }
        tx.execute(
            "UPDATE ai_provider_keys SET credential_ref = ?2, updated_at = ?3 WHERE id = ?1",
            params![key, reference, now_ms()],
        )?;
        tx.execute("UPDATE ai_providers SET base_url = ?2, current_key_id = ?3, current_model_id = ?4, revision = revision + 1, updated_at = ?5 WHERE id = ?1",
            params![provider, config.base_url, key, model, now_ms()])?;
        tx.execute("UPDATE ai_settings SET active_provider_id = ?1, streaming_enabled = ?2, revision = revision + 1 WHERE id = 1",
            params![provider, i64::from(config.streaming_enabled)])?;
        tx.commit()?;
        Ok(())
    }
}

fn select_model(tx: &Transaction<'_>, provider: &str, model: &str) -> AppResult<String> {
    let existing = tx
        .query_row(
            "SELECT id FROM ai_provider_models WHERE provider_id = ?1 AND model_key = ?2",
            params![provider, model.trim()],
            |r| r.get::<_, String>(0),
        )
        .optional()?;
    if let Some(id) = existing {
        tx.execute(
            "UPDATE ai_provider_models SET model_id = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, model, now_ms()],
        )?;
        return Ok(id);
    }
    let count: i64 = tx.query_row(
        "SELECT COUNT(*) FROM ai_provider_models WHERE provider_id = ?1",
        [provider],
        |r| r.get(0),
    )?;
    if count >= super::validation::MODEL_LIMIT {
        return Err(AppError::custom(CustomErrorCode::AiModelLimit));
    }
    let id = uuid::Uuid::new_v4().to_string();
    tx.execute("INSERT INTO ai_provider_models(id, provider_id, model_id, model_key, created_at, updated_at) VALUES(?1, ?2, ?3, ?4, ?5, ?5)",
        params![id, provider, model, model.trim(), now_ms()])?;
    Ok(id)
}

fn select_key(tx: &Transaction<'_>, provider: &str) -> AppResult<(String, Option<String>)> {
    let selected = tx.query_row("SELECT k.id, k.credential_ref FROM ai_providers p JOIN ai_provider_keys k ON k.id = p.current_key_id AND k.provider_id = p.id WHERE p.id = ?1",
        [provider], |r| Ok((r.get(0)?, r.get(1)?))).optional()?;
    if let Some(key) = selected {
        return Ok(key);
    }
    let existing = tx.query_row("SELECT id, credential_ref FROM ai_provider_keys WHERE provider_id = ?1 ORDER BY created_at, id LIMIT 1",
        [provider], |r| Ok((r.get(0)?, r.get(1)?))).optional()?;
    if let Some(key) = existing {
        return Ok(key);
    }
    let id = uuid::Uuid::new_v4().to_string();
    tx.execute(
        "INSERT INTO ai_provider_keys VALUES(?1, ?2, 'default', NULL, ?3, ?3)",
        params![id, provider, now_ms()],
    )?;
    Ok((id, None))
}
