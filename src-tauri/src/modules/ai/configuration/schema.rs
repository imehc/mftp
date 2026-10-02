use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};

use crate::error::{AppError, AppResult, CustomErrorCode};
use crate::modules::ai::{legacy_schema, service::url};

pub(in crate::modules::ai) const VERSION: i64 = 3;
pub(in crate::modules::ai) const LEGACY_PROVIDER: &str = "1e227548-da9b-52f8-8e79-18175d9a0df7";
pub(in crate::modules::ai) const LEGACY_KEY: &str = "73f7eabc-03ce-5cb1-9452-4db4eb464d1b";
pub(in crate::modules::ai) const LEGACY_MODEL: &str = "f9e51a88-54bc-51d8-8a5e-5b0d58d389bc";

pub(in crate::modules::ai) fn normalized_endpoint(base_url: &str) -> AppResult<String> {
    let config = url::validate_connection(base_url, "migration-validation")?;
    // Use the same endpoint builder as actual AI requests. Url canonicalizes
    // host casing/default ports while preserving case-sensitive service paths.
    let parsed = ::url::Url::parse(&url::responses_endpoint(&config.base_url))
        .map_err(|_| AppError::custom(CustomErrorCode::AiAddressInvalid))?;
    Ok(parsed.to_string())
}

pub(in crate::modules::ai) fn init(conn: &mut Connection) -> AppResult<()> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let version = legacy_schema::read_version(&tx)?;
    if version > VERSION {
        return Err(AppError::custom(CustomErrorCode::AiSchemaTooNew));
    }
    if version == VERSION {
        tx.commit()?;
        return Ok(());
    }
    let already_v3: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name = 'ai_settings')",
        [],
        |r| r.get(0),
    )?;
    if already_v3 {
        // A missing/corrupt marker must not recreate a legacy row or overwrite
        // an existing multi-provider database. Recovery needs its real version.
        return Err(AppError::from(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "AI configuration tables exist without their schema version",
        )));
    }
    legacy_schema::ensure_v2(&tx)?;
    tx.execute_batch(include_str!("schema.sql"))?;
    migrate_connection(&tx)?;
    tx.execute("DROP TABLE ai_connection", [])?;
    tx.execute(
        "INSERT INTO app_meta(key, value) VALUES('ai_schema_version', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [VERSION.to_string()],
    )?;
    tx.commit()?;
    Ok(())
}

fn migrate_connection(tx: &Transaction<'_>) -> AppResult<()> {
    let legacy: Option<(String, String, i64, i64)> = tx
        .query_row(
            "SELECT base_url, model, streaming_enabled, updated_at FROM ai_connection WHERE id = 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()?;
    let Some((base_url, model, streaming, updated_at)) = legacy else {
        return Ok(());
    };
    // Legacy values remain byte-for-byte intact, including invalid historical
    // URLs. A NULL endpoint marks repair-needed data without aborting startup.
    let endpoint = normalized_endpoint(&base_url).ok();
    tx.execute(
        "INSERT INTO ai_providers(id, name, base_url, endpoint_key, current_key_id,
         current_model_id, created_at, updated_at) VALUES(?1, 'default', ?2, ?3, ?4, ?5, ?6, ?6)",
        params![
            LEGACY_PROVIDER,
            base_url,
            endpoint,
            LEGACY_KEY,
            LEGACY_MODEL,
            updated_at
        ],
    )?;
    // Preserve the old credential account in place. SQL never checks whether
    // the system keychain currently contains it; reads expose unverified status.
    tx.execute(
        "INSERT INTO ai_provider_keys(id, provider_id, label, credential_ref, created_at, updated_at)
         VALUES(?1, ?2, 'default', 'default', ?3, ?3)",
        params![LEGACY_KEY, LEGACY_PROVIDER, updated_at],
    )?;
    tx.execute(
        "INSERT INTO ai_provider_models(id, provider_id, model_id, model_key, created_at, updated_at)
         VALUES(?1, ?2, ?3, ?4, ?5, ?5)",
        params![LEGACY_MODEL, LEGACY_PROVIDER, model, model.trim(), updated_at],
    )?;
    tx.execute(
        "UPDATE ai_settings SET active_provider_id = ?1, streaming_enabled = ?2 WHERE id = 1",
        params![LEGACY_PROVIDER, i64::from(streaming != 0)],
    )?;
    Ok(())
}

pub(in crate::modules::ai) fn reset(
    tx: &Transaction<'_>,
    operation_id: &str,
    now: i64,
) -> AppResult<usize> {
    // Queue every owned reference before removing metadata. The journal is
    // deliberately not cleared by reset; 4C drains it after the SQL commit.
    tx.execute(
        "INSERT OR IGNORE INTO ai_credential_journal(credential_ref, operation_id, phase, created_at)
         SELECT credential_ref, ?1, 'retired', ?2 FROM ai_provider_keys WHERE credential_ref IS NOT NULL",
        params![operation_id, now],
    )?;
    tx.execute(
        "INSERT OR IGNORE INTO ai_credential_journal VALUES('default', ?1, 'retired', ?2)",
        params![operation_id, now],
    )?;
    // Keep revisions monotonic across reset so stale windows cannot match a
    // freshly reset database's old revision. The CHECK rejects overflow.
    tx.execute(
        "UPDATE ai_settings SET active_provider_id = NULL, streaming_enabled = 1, revision = revision + 1",
        [],
    )?;
    // Deferred selection FKs allow children and parents to be removed within
    // the same transaction while reporting actual affected row counts.
    let keys = tx.execute("DELETE FROM ai_provider_keys", [])?;
    let models = tx.execute("DELETE FROM ai_provider_models", [])?;
    let providers = tx.execute("DELETE FROM ai_providers", [])?;
    let translations = tx.execute("DELETE FROM ai_poetry_translations", [])?;
    Ok(keys + models + providers + translations)
}

#[cfg(test)]
#[path = "schema_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "constraints_tests.rs"]
mod constraints_tests;
