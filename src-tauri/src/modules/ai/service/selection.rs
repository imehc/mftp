use super::*;
use crate::modules::ai::configuration::{
    input::*,
    model::AiConfigurationView,
    testing::{AiProviderTestMode, AiProviderTestReport},
};

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

    #[cfg(test)]
    pub(crate) async fn test_provider(
        self: &Arc<Self>,
        input: AiProviderTargetInput,
    ) -> AppResult<AiProviderTestReport> {
        self.test_saved(Some(input), AiProviderTestMode::NonStreaming)
            .await
    }

    #[cfg(test)]
    pub(crate) async fn test_provider_streaming(
        self: &Arc<Self>,
        input: AiProviderTargetInput,
    ) -> AppResult<AiProviderTestReport> {
        self.test_saved(Some(input), AiProviderTestMode::Streaming)
            .await
    }

    #[cfg(test)]
    pub(super) async fn test_saved(
        self: &Arc<Self>,
        target: Option<AiProviderTargetInput>,
        mode: AiProviderTestMode,
    ) -> AppResult<AiProviderTestReport> {
        self.test_logged(target, mode, None).await
    }

    pub(crate) async fn test_provider_logged(
        self: &Arc<Self>,
        input: AiProviderTargetInput,
        mode: AiProviderTestMode,
        log: Option<crate::core::diagnostics::DiagnosticRecorder>,
    ) -> AppResult<AiProviderTestReport> {
        self.test_logged(Some(input), mode, log).await
    }

    async fn test_logged(
        self: &Arc<Self>,
        target: Option<AiProviderTargetInput>,
        mode: AiProviderTestMode,
        mut log: Option<crate::core::diagnostics::DiagnosticRecorder>,
    ) -> AppResult<AiProviderTestReport> {
        let service = self.clone();
        let mut activity = crate::core::activity::OperationContext::new(
            "ai",
            if mode == AiProviderTestMode::Streaming {
                "ai_provider_test_streaming"
            } else {
                "ai_provider_test"
            },
            target
                .as_ref()
                .map(|target| target.provider_id.clone())
                .unwrap_or_else(|| "local".into()),
        );
        activity.operation_id = log.as_ref().map(|log| log.id().to_string());
        // Keep one continuous lease from snapshot admission to real HTTP worker
        // completion, even when the IPC waiter closes during either phase.
        tauri::async_runtime::spawn(async move {
            let lease = service.operations.begin();
            let result: AppResult<AiProviderTestReport> = async {
                lease.as_ref().map_err(Clone::clone)?;
                let snapshot = {
                    let _lock = service.coordinator.lock().await;
                    service.snapshot_locked(target).await?
                };
                if let Some(log) = log.as_mut() {
                    log.add_secret(&snapshot.api_key);
                    log.target(&snapshot.config.model);
                }
                Ok(super::super::probe::run_probe_logged(
                    &snapshot.config,
                    &snapshot.api_key,
                    mode,
                    crate::modules::ai::completion::AiTimeoutPolicy::probe(),
                    log.as_mut(),
                )
                .await)
            }
            .await;
            if lease.is_ok() {
                service
                    .executor
                    .record_outcome(
                        activity,
                        match &result {
                            Ok(report) => report.error.clone(),
                            Err(error) => Some(error.clone()),
                        },
                    )
                    .await;
            }
            if let Some(log) = log.as_mut() {
                log.finish(match &result {
                    Ok(report) => report.error.as_ref(),
                    Err(error) => Some(error),
                });
            }
            result
        })
        .await
        .map_err(AppError::from)?
    }
}
