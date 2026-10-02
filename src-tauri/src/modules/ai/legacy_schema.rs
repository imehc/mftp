//! AI table ownership. Startup and reset run on every platform, including iOS.
//! Translation content is accessed only by the poetry translation repository.

#[cfg(test)]
use rusqlite::{params, TransactionBehavior};
use rusqlite::{Connection, OptionalExtension, Transaction};

#[cfg(test)]
use crate::error::CustomErrorCode;
use crate::error::{AppError, AppResult};
use crate::storage::add_column_if_missing;

#[cfg(test)]
pub(super) const AI_SCHEMA_VERSION: i64 = 2;

#[cfg(test)]
pub(crate) fn init(conn: &mut Connection) -> AppResult<()> {
    // Serialize schema inspection with DDL and publish the version atomically.
    // In particular, a failed marker write must not leave a partial migration.
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let version = read_version(&tx)?;
    // Do not touch AI tables owned by a newer application version.
    if version > AI_SCHEMA_VERSION {
        return Err(AppError::custom(CustomErrorCode::AiSchemaTooNew));
    }
    ensure_v2(&tx)?;
    if version < AI_SCHEMA_VERSION {
        tx.execute(
            "INSERT INTO app_meta(key, value) VALUES('ai_schema_version', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![AI_SCHEMA_VERSION.to_string()],
        )?;
    }
    tx.commit()?;
    Ok(())
}

pub(super) fn read_version(conn: &Connection) -> AppResult<i64> {
    let raw_version: Option<String> = conn
        .query_row(
            "SELECT value FROM app_meta WHERE key = 'ai_schema_version'",
            [],
            |row| row.get(0),
        )
        .optional()?;
    let version = match raw_version {
        None => 0,
        Some(value) => value
            .parse::<i64>()
            .ok()
            .filter(|v| *v >= 0)
            .ok_or_else(|| {
                AppError::from(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "Invalid AI schema version",
                ))
            })?,
    };
    Ok(version)
}

pub(super) fn ensure_v2(tx: &Transaction<'_>) -> AppResult<()> {
    tx.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS ai_connection (
            id INTEGER PRIMARY KEY CHECK(id = 1),
            base_url TEXT NOT NULL,
            model TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            streaming_enabled INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE IF NOT EXISTS ai_poetry_translations (
            id TEXT PRIMARY KEY,
            poem_uid TEXT NOT NULL,
            body_fingerprint TEXT NOT NULL,
            language TEXT NOT NULL,
            mode TEXT NOT NULL,
            prompt_version INTEGER NOT NULL,
            content TEXT NOT NULL,
            source TEXT NOT NULL,
            model TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            UNIQUE(poem_uid, body_fingerprint, language, mode, prompt_version)
        );
        CREATE INDEX IF NOT EXISTS idx_ai_poetry_translations_poem
        ON ai_poetry_translations(poem_uid, body_fingerprint, language, prompt_version);
        "#,
    )?;
    // Older databases can already have the column but lack their version marker.
    // Inspect the column itself so reopening cannot replay an ALTER TABLE.
    add_column_if_missing(
        tx,
        "ai_connection",
        "streaming_enabled",
        "INTEGER NOT NULL DEFAULT 1",
    )?;
    Ok(())
}

#[cfg(test)]
#[path = "legacy_schema_tests.rs"]
mod tests;
