use super::{
    input::{AiModelDeleteInput, AiModelSaveInput},
    model::AiConfigurationView,
    transaction as tx,
    validation::MODEL_LIMIT,
};
use crate::{
    error::{AppError, AppResult, CustomErrorCode as Code},
    modules::ai::AiRepository,
    storage::now_ms,
};
use rusqlite::{params, Connection};

pub(super) fn model(conn: &Connection, provider: &str, id: &str) -> AppResult<String> {
    use rusqlite::OptionalExtension;
    conn.query_row(
        "SELECT model_id FROM ai_provider_models WHERE provider_id = ?1 AND id = ?2",
        params![provider, id],
        |r| r.get(0),
    )
    .optional()?
    .ok_or_else(|| AppError::custom(Code::AiModelNotFound))
}

impl AiRepository {
    pub(in crate::modules::ai) fn save_model(
        &self,
        input: &AiModelSaveInput,
    ) -> AppResult<AiConfigurationView> {
        self.change(input.expected_revision, |t| {
            tx::provider(t, &input.provider_id)?;
            let count: i64 = t.query_row("SELECT COUNT(*) FROM ai_provider_models WHERE provider_id = ?1", [&input.provider_id], |r| r.get(0))?;
            if let Some(id) = &input.id { model(t, &input.provider_id, id)?; }
            else if count >= MODEL_LIMIT { return Err(AppError::custom(Code::AiModelLimit)); }
            let duplicate: bool = t.query_row("SELECT EXISTS(SELECT 1 FROM ai_provider_models WHERE provider_id = ?1 AND model_key = ?2 AND (?3 IS NULL OR id <> ?3))", params![input.provider_id, input.model_id, input.id], |r| r.get(0))?;
            if duplicate { return Err(AppError::custom(Code::AiModelDuplicate)); }
            let id = input.id.clone().unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
            if input.id.is_some() {
                t.execute("UPDATE ai_provider_models SET model_id = ?2, model_key = ?2, display_name = ?3, updated_at = ?4 WHERE id = ?1", params![id, input.model_id, input.display_name, now_ms()])?;
            } else {
                t.execute("INSERT INTO ai_provider_models VALUES(?1, ?2, ?3, ?3, ?4, ?5, ?6, ?6)", params![id, input.provider_id, input.model_id, input.display_name, count, now_ms()])?;
                t.execute("UPDATE ai_providers SET current_model_id = COALESCE(current_model_id, ?2) WHERE id = ?1", params![input.provider_id, id])?;
            }
            tx::touch(t, &input.provider_id)
        })
    }
    pub(in crate::modules::ai) fn delete_model(
        &self,
        input: &AiModelDeleteInput,
    ) -> AppResult<AiConfigurationView> {
        self.change(input.expected_revision, |t| {
            let (_, current) = tx::provider(t, &input.provider_id)?;
            model(t, &input.provider_id, &input.id)?;
            let count: i64 = t.query_row(
                "SELECT COUNT(*) FROM ai_provider_models WHERE provider_id = ?1",
                [&input.provider_id],
                |r| r.get(0),
            )?;
            if count <= 1 {
                return Err(AppError::custom(Code::AiLastModel));
            }
            if let Some(replacement) = &input.replacement_model_id {
                if replacement == &input.id {
                    return Err(AppError::custom(Code::AiReplacementRequired));
                }
                model(t, &input.provider_id, replacement)?;
            }
            if current.as_ref() == Some(&input.id) {
                let replacement = input
                    .replacement_model_id
                    .as_ref()
                    .ok_or_else(|| AppError::custom(Code::AiReplacementRequired))?;
                t.execute(
                    "UPDATE ai_providers SET current_model_id = ?2 WHERE id = ?1",
                    params![input.provider_id, replacement],
                )?;
            }
            t.execute("DELETE FROM ai_provider_models WHERE id = ?1", [&input.id])?;
            tx::touch(t, &input.provider_id)
        })
    }
}
