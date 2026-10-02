use super::{
    input::{AiProviderDeleteInput, AiProviderUpdateInput},
    model::AiConfigurationView,
    schema::normalized_endpoint,
    transaction as tx,
    validation::{NewProvider, PROVIDER_LIMIT},
};
use crate::{
    error::{AppError, AppResult, CustomErrorCode as Code},
    modules::ai::AiRepository,
    storage::now_ms,
};
use rusqlite::{params, Connection};

fn unique_endpoint(conn: &Connection, base: &str, except: Option<&str>) -> AppResult<String> {
    let endpoint = normalized_endpoint(base)?;
    let duplicate: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM ai_providers WHERE endpoint_key = ?1 AND (?2 IS NULL OR id <> ?2))", params![endpoint, except], |r| r.get(0))?;
    if duplicate {
        return Err(AppError::custom(Code::AiProviderDuplicate));
    }
    Ok(endpoint)
}
fn check_create(conn: &Connection, input: &NewProvider) -> AppResult<String> {
    tx::revision(conn, input.expected_revision)?;
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM ai_providers", [], |r| r.get(0))?;
    if count >= PROVIDER_LIMIT {
        return Err(AppError::custom(Code::AiProviderLimit));
    }
    unique_endpoint(conn, &input.base_url, None)
}
impl AiRepository {
    pub(in crate::modules::ai) fn prepare_provider(&self, input: &NewProvider) -> AppResult<()> {
        check_create(&self.storage.conn()?, input).map(|_| ())
    }
    pub(in crate::modules::ai) fn create_provider(
        &self,
        input: &NewProvider,
        reference: &str,
    ) -> AppResult<AiConfigurationView> {
        self.change(input.expected_revision, |t| {
            let endpoint = check_create(t, input)?;
            let provider = uuid::Uuid::new_v4().to_string();
            let key = uuid::Uuid::new_v4().to_string();
            let model = uuid::Uuid::new_v4().to_string();
            let first: bool = t.query_row("SELECT NOT EXISTS(SELECT 1 FROM ai_providers)", [], |r| r.get(0))?;
            t.execute("INSERT INTO ai_providers(id, name, base_url, endpoint_key, current_key_id, current_model_id, created_at, updated_at) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
                params![provider, input.name, input.base_url, endpoint, key, model, now_ms()])?;
            t.execute("INSERT INTO ai_provider_keys VALUES(?1, ?2, ?3, ?4, ?5, ?5)", params![key, provider, input.label, reference, now_ms()])?;
            t.execute("INSERT INTO ai_provider_models VALUES(?1, ?2, ?3, ?3, ?4, 0, ?5, ?5)", params![model, provider, input.model, input.display, now_ms()])?;
            tx::publish(t, reference)?;
            if first {
                t.execute("UPDATE ai_settings SET active_provider_id = ?1 WHERE id = 1", [&provider])?;
                tx::retire(t, "default")?;
            }
            Ok(())
        })
    }
    pub(in crate::modules::ai) fn update_provider(
        &self,
        input: &AiProviderUpdateInput,
    ) -> AppResult<AiConfigurationView> {
        self.change(input.expected_revision, |t| {
            tx::provider(t, &input.provider_id)?;
            let endpoint = unique_endpoint(t, &input.base_url, Some(&input.provider_id))?;
            t.execute(
                "UPDATE ai_providers SET name = ?2, base_url = ?3, endpoint_key = ?4 WHERE id = ?1",
                params![input.provider_id, input.name, input.base_url, endpoint],
            )?;
            tx::touch(t, &input.provider_id)
        })
    }
    pub(in crate::modules::ai) fn delete_provider(
        &self,
        input: &AiProviderDeleteInput,
    ) -> AppResult<AiConfigurationView> {
        self.change(input.expected_revision, |t| {
            tx::provider(t, &input.provider_id)?;
            let references = t.prepare("SELECT credential_ref FROM ai_provider_keys WHERE provider_id = ?1 AND credential_ref IS NOT NULL")?
                .query_map([&input.provider_id], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
            for reference in references { tx::retire(t, &reference)?; }
            // The FK clears active selection; it never enables a different provider.
            t.execute("DELETE FROM ai_providers WHERE id = ?1", [&input.provider_id])?;
            Ok(())
        })
    }
}
