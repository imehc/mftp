use super::*;
use crate::core::execution::run_blocking_guarded;
use crate::modules::ai::configuration::{input::*, model::AiConfigurationView};

impl<C: AiCredentials + 'static> AiConfigurationService<C> {
    async fn selection_change(
        self: &Arc<Self>,
        action: &'static str,
        apply: impl FnOnce(AiRepository) -> AppResult<AiConfigurationView> + Send + 'static,
    ) -> AppResult<AiConfigurationView> {
        // Selection only changes metadata; it must not prompt the OS keychain.
        self.owned(Some(action), |s| async move { s.db(apply).await })
            .await
    }

    pub(crate) async fn activate_provider(
        self: &Arc<Self>,
        input: AiProviderTargetInput,
    ) -> AppResult<AiConfigurationView> {
        self.selection_change("ai_provider_activate", move |r| r.activate_provider(&input))
            .await
    }
    pub(crate) async fn select_provider_options(
        self: &Arc<Self>,
        input: AiProviderSelectionInput,
    ) -> AppResult<AiConfigurationView> {
        self.selection_change("ai_provider_select", move |r| {
            r.select_provider_options(&input)
        })
        .await
    }
    pub(crate) async fn switch_current_model(
        self: &Arc<Self>,
        input: AiModelSwitchInput,
    ) -> AppResult<AiConfigurationView> {
        self.selection_change("ai_model_switch", move |r| r.switch_current_model(&input))
            .await
    }
    pub(crate) async fn update_streaming(
        self: &Arc<Self>,
        input: AiStreamingUpdateInput,
    ) -> AppResult<AiConfigurationView> {
        self.selection_change("ai_streaming_update", move |r| r.update_streaming(&input))
            .await
    }

    // The caller owns coordination until every component of this snapshot has
    // been captured. No configuration lock is retained by the network worker.
    pub(super) async fn snapshot_locked(
        &self,
        target: Option<AiProviderTargetInput>,
    ) -> AppResult<AiRequestSnapshot> {
        let stored = self
            .db(move |r| match target {
                Some(input) => r.targeted_connection(&input),
                None => r.selected(),
            })
            .await?;
        let (config, reference) = stored.validated()?;
        self.recover_best_effort().await;
        let api_key = self
            .credentials
            .read(reference)
            .await?
            .ok_or_else(|| AppError::custom(CustomErrorCode::AiApiKeyMissing))?;
        Ok(AiRequestSnapshot { config, api_key })
    }

    pub(crate) async fn test_provider(
        self: &Arc<Self>,
        input: AiProviderTargetInput,
    ) -> AppResult<()> {
        self.test_saved(Some(input)).await
    }

    pub(super) async fn test_saved(
        self: &Arc<Self>,
        target: Option<AiProviderTargetInput>,
    ) -> AppResult<()> {
        let service = self.clone();
        // Keep one continuous lease from snapshot admission to real HTTP worker
        // completion, even when the IPC waiter closes during either phase.
        tauri::async_runtime::spawn(async move {
            let lease = service.operations.begin()?;
            let snapshot = {
                let _lock = service.coordinator.lock().await;
                service.snapshot_locked(target).await?
            };
            run_blocking_guarded(lease, move || {
                test_connection(&snapshot.config, &snapshot.api_key)
            })
            .await
        })
        .await
        .map_err(AppError::from)?
    }
}
