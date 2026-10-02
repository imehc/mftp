use super::{input::*, keys, model::AiConfigurationView, models, transaction as tx, validation};
use crate::{
    error::{AppError, AppResult, CustomErrorCode as Code},
    modules::ai::{
        repository::{connection_in, StoredConnection},
        AiRepository,
    },
};
use rusqlite::params;

impl AiRepository {
    pub(in crate::modules::ai) fn activate_provider(
        &self,
        input: &AiProviderTargetInput,
    ) -> AppResult<AiConfigurationView> {
        self.change(input.expected_revision, |t| {
            tx::provider(t, &input.provider_id)?;
            // Completeness here means valid saved metadata, not a remote/keychain
            // health check. Actual requests distinguish missing and unavailable keys.
            connection_in(t, Some(&input.provider_id))?.validated()?;
            t.execute(
                "UPDATE ai_settings SET active_provider_id = ?1 WHERE id = 1",
                [&input.provider_id],
            )?;
            Ok(())
        })
    }

    pub(in crate::modules::ai) fn select_provider_options(
        &self,
        input: &AiProviderSelectionInput,
    ) -> AppResult<AiConfigurationView> {
        self.change(input.expected_revision, |t| {
            tx::provider(t, &input.provider_id)?;
            keys::key(t, &input.provider_id, &input.current_key_id)?;
            validation::model_id(&models::model(
                t,
                &input.provider_id,
                &input.current_model_id,
            )?)?;
            t.execute(
                "UPDATE ai_providers SET current_key_id = ?2, current_model_id = ?3 WHERE id = ?1",
                params![
                    input.provider_id,
                    input.current_key_id,
                    input.current_model_id
                ],
            )?;
            tx::touch(t, &input.provider_id)
        })
    }

    pub(in crate::modules::ai) fn switch_current_model(
        &self,
        input: &AiModelSwitchInput,
    ) -> AppResult<AiConfigurationView> {
        self.change(input.expected_revision, |t| {
            let active: Option<String> = t.query_row(
                "SELECT active_provider_id FROM ai_settings WHERE id = 1",
                [],
                |r| r.get(0),
            )?;
            if active.as_ref() != Some(&input.expected_active_provider_id) {
                return Err(AppError::custom(Code::AiActiveProviderChanged));
            }
            validation::model_id(&models::model(
                t,
                &input.expected_active_provider_id,
                &input.model_id,
            )?)?;
            t.execute(
                "UPDATE ai_providers SET current_model_id = ?2 WHERE id = ?1",
                params![input.expected_active_provider_id, input.model_id],
            )?;
            tx::touch(t, &input.expected_active_provider_id)
        })
    }

    pub(in crate::modules::ai) fn update_streaming(
        &self,
        input: &AiStreamingUpdateInput,
    ) -> AppResult<AiConfigurationView> {
        self.change(input.expected_revision, |t| {
            t.execute(
                "UPDATE ai_settings SET streaming_enabled = ?1 WHERE id = 1",
                [i64::from(input.streaming_enabled)],
            )?;
            Ok(())
        })
    }

    pub(in crate::modules::ai) fn targeted_connection(
        &self,
        input: &AiProviderTargetInput,
    ) -> AppResult<StoredConnection> {
        let mut conn = self.storage.conn()?;
        let t = conn.transaction()?;
        // Testing is read-only and may use the maximum representable revision.
        tx::read_revision(&t, input.expected_revision)?;
        tx::provider(&t, &input.provider_id)?;
        let stored = connection_in(&t, Some(&input.provider_id))?;
        t.commit()?;
        Ok(stored)
    }
}
