use super::{model::AiConfigurationView, read};
use crate::{
    error::{AppError, AppResult, CustomErrorCode as Code},
    modules::ai::AiRepository,
    storage::now_ms,
};
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};

pub(super) fn revision(conn: &Connection, expected: i64) -> AppResult<()> {
    read_revision(conn, expected)?;
    if expected == 9_007_199_254_740_991 {
        return Err(AppError::custom(Code::AiRevisionConflict));
    }
    Ok(())
}

pub(super) fn read_revision(conn: &Connection, expected: i64) -> AppResult<()> {
    let current: i64 =
        conn.query_row("SELECT revision FROM ai_settings WHERE id = 1", [], |r| {
            r.get(0)
        })?;
    if expected != current || !(0..=9_007_199_254_740_991).contains(&expected) {
        return Err(AppError::custom(Code::AiRevisionConflict));
    }
    Ok(())
}

pub(super) fn provider(conn: &Connection, id: &str) -> AppResult<(Option<String>, Option<String>)> {
    conn.query_row(
        "SELECT current_key_id, current_model_id FROM ai_providers WHERE id = ?1",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .optional()?
    .ok_or_else(|| AppError::custom(Code::AiProviderNotFound))
}

pub(super) fn touch(tx: &Transaction<'_>, id: &str) -> AppResult<()> {
    tx.execute(
        "UPDATE ai_providers SET revision = revision + 1, updated_at = ?2 WHERE id = ?1",
        params![id, now_ms()],
    )?;
    Ok(())
}

pub(super) fn retire(tx: &Transaction<'_>, reference: &str) -> AppResult<()> {
    tx.execute(
        "INSERT OR IGNORE INTO ai_credential_journal VALUES(?1, ?2, 'retired', ?3)",
        params![reference, uuid::Uuid::new_v4().to_string(), now_ms()],
    )?;
    Ok(())
}

pub(super) fn publish(tx: &Transaction<'_>, reference: &str) -> AppResult<()> {
    let removed = tx.execute(
        "DELETE FROM ai_credential_journal WHERE credential_ref = ?1 AND phase = 'unpublished'",
        [reference],
    )?;
    if removed != 1 {
        return Err(AppError::external(
            "db:operation",
            "AI credential publication has no preparation record",
        ));
    }
    Ok(())
}

impl AiRepository {
    pub(super) fn change(
        &self,
        expected: i64,
        apply: impl FnOnce(&Transaction<'_>) -> AppResult<()>,
    ) -> AppResult<AiConfigurationView> {
        let mut conn = self.storage.conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        revision(&tx, expected)?;
        apply(&tx)?;
        tx.execute(
            "UPDATE ai_settings SET revision = revision + 1 WHERE id = 1",
            [],
        )?;
        // Build the public result before commit: read failure cannot report a
        // failed save after its metadata has already become visible.
        let view = read::snapshot_in(&tx)?;
        tx.commit()?;
        Ok(view)
    }
}
