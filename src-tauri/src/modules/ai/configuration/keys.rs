use super::{
    input::AiKeyDeleteInput,
    model::AiConfigurationView,
    transaction as tx,
    validation::{KeyDraft, KEY_LIMIT},
};
use crate::{
    error::{AppError, AppResult, CustomErrorCode as Code},
    modules::ai::AiRepository,
    storage::now_ms,
};
use rusqlite::{params, Connection, OptionalExtension};

pub(super) fn key(conn: &Connection, provider: &str, id: &str) -> AppResult<Option<String>> {
    conn.query_row(
        "SELECT credential_ref FROM ai_provider_keys WHERE provider_id = ?1 AND id = ?2",
        params![provider, id],
        |r| r.get(0),
    )
    .optional()?
    .ok_or_else(|| AppError::custom(Code::AiKeyNotFound))
}
fn check_save(conn: &Connection, input: &KeyDraft) -> AppResult<Option<String>> {
    tx::revision(conn, input.expected_revision)?;
    tx::provider(conn, &input.provider_id)?;
    let previous = if let Some(id) = &input.key_id {
        key(conn, &input.provider_id, id)?
    } else {
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM ai_provider_keys WHERE provider_id = ?1",
            [&input.provider_id],
            |r| r.get(0),
        )?;
        if count >= KEY_LIMIT {
            return Err(AppError::custom(Code::AiKeyLimit));
        }
        None
    };
    let duplicate: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM ai_provider_keys WHERE provider_id = ?1 AND label = ?2 AND (?3 IS NULL OR id <> ?3))",
        params![input.provider_id, input.label, input.key_id], |r| r.get(0))?;
    if duplicate {
        return Err(AppError::custom(Code::AiKeyDuplicate));
    }
    Ok(previous)
}
impl AiRepository {
    pub(in crate::modules::ai) fn prepare_key(&self, input: &KeyDraft) -> AppResult<()> {
        check_save(&self.storage.conn()?, input).map(|_| ())
    }
    pub(in crate::modules::ai) fn save_key(
        &self,
        input: &KeyDraft,
        replacement: Option<&str>,
    ) -> AppResult<AiConfigurationView> {
        self.change(input.expected_revision, |t| {
            let previous = check_save(t, input)?;
            let id = input.key_id.clone().unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
            let reference = replacement.map(str::to_owned).or_else(|| previous.clone());
            if input.key_id.is_none() && reference.is_none() { return Err(AppError::custom(Code::AiApiKeyMissing)); }
            if input.key_id.is_some() {
                t.execute("UPDATE ai_provider_keys SET label = ?2, credential_ref = ?3, updated_at = ?4 WHERE id = ?1", params![id, input.label, reference, now_ms()])?;
            } else {
                t.execute("INSERT INTO ai_provider_keys VALUES(?1, ?2, ?3, ?4, ?5, ?5)", params![id, input.provider_id, input.label, reference, now_ms()])?;
                t.execute("UPDATE ai_providers SET current_key_id = COALESCE(current_key_id, ?2) WHERE id = ?1", params![input.provider_id, id])?;
            }
            if let Some(reference) = replacement {
                tx::publish(t, reference)?;
                if let Some(previous) = previous { tx::retire(t, &previous)?; }
            }
            tx::touch(t, &input.provider_id)
        })
    }
    pub(in crate::modules::ai) fn delete_key(
        &self,
        input: &AiKeyDeleteInput,
    ) -> AppResult<AiConfigurationView> {
        self.change(input.expected_revision, |t| {
            let (current, _) = tx::provider(t, &input.provider_id)?;
            let reference = key(t, &input.provider_id, &input.key_id)?;
            let count: i64 = t.query_row(
                "SELECT COUNT(*) FROM ai_provider_keys WHERE provider_id = ?1",
                [&input.provider_id],
                |r| r.get(0),
            )?;
            if count <= 1 {
                return Err(AppError::custom(Code::AiLastKey));
            }
            if let Some(replacement) = &input.replacement_key_id {
                if replacement == &input.key_id {
                    return Err(AppError::custom(Code::AiReplacementRequired));
                }
                key(t, &input.provider_id, replacement)?;
            }
            if current.as_ref() == Some(&input.key_id) {
                let replacement = input
                    .replacement_key_id
                    .as_ref()
                    .ok_or_else(|| AppError::custom(Code::AiReplacementRequired))?;
                t.execute(
                    "UPDATE ai_providers SET current_key_id = ?2 WHERE id = ?1",
                    params![input.provider_id, replacement],
                )?;
            }
            if let Some(reference) = reference {
                tx::retire(t, &reference)?;
            }
            t.execute(
                "DELETE FROM ai_provider_keys WHERE id = ?1",
                [&input.key_id],
            )?;
            tx::touch(t, &input.provider_id)
        })
    }
}
