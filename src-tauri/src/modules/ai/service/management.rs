use super::*;
use crate::modules::ai::configuration::{
    input::*,
    model::AiConfigurationView,
    validation::{self, KeyDraft, NewProvider},
};

impl<C: AiCredentials + 'static> AiConfigurationService<C> {
    pub(crate) async fn configuration(self: &Arc<Self>) -> AppResult<AiConfigurationView> {
        // Listing must not touch the credential store, including pending cleanup.
        self.owned(None, |s| async move { s.db(|r| r.configuration()).await })
            .await
    }

    async fn publish_management(
        &self,
        secret: Option<String>,
        prepare: impl FnOnce(AiRepository) -> AppResult<()> + Send + 'static,
        publish: impl FnOnce(AiRepository, Option<String>) -> AppResult<AiConfigurationView>
            + Send
            + 'static,
    ) -> AppResult<AiConfigurationView> {
        self.db(prepare).await?;
        self.recover_best_effort().await;
        let reference = if let Some(secret) = secret {
            let reference = format!("ai-{}", uuid::Uuid::new_v4());
            let staged = reference.clone();
            self.db(move |r| r.stage_credential(&staged)).await?;
            if let Err(error) = self.credentials.save(reference.clone(), secret).await {
                self.recover_best_effort().await;
                return Err(error);
            }
            Some(reference)
        } else {
            None
        };
        let result = self.db(move |r| publish(r, reference)).await;
        self.recover_best_effort().await;
        result
    }

    async fn management_change(
        self: &Arc<Self>,
        action: &'static str,
        apply: impl FnOnce(AiRepository) -> AppResult<AiConfigurationView> + Send + 'static,
    ) -> AppResult<AiConfigurationView> {
        self.owned(Some(action), |s| async move {
            let result = s.db(apply).await;
            s.recover_best_effort().await;
            result
        })
        .await
    }

    pub(crate) async fn create_provider(
        self: &Arc<Self>,
        input: AiProviderCreateInput,
    ) -> AppResult<AiConfigurationView> {
        self.owned(Some("ai_provider_create"), |s| async move {
            let (draft, secret) = NewProvider::prepare(input)?;
            let checked = draft.clone();
            s.publish_management(
                Some(secret),
                move |r| r.prepare_provider(&checked),
                move |r, reference| {
                    let reference = reference
                        .ok_or_else(|| AppError::custom(CustomErrorCode::AiApiKeyMissing))?;
                    r.create_provider(&draft, &reference)
                },
            )
            .await
        })
        .await
    }
    pub(crate) async fn update_provider(
        self: &Arc<Self>,
        input: AiProviderUpdateInput,
    ) -> AppResult<AiConfigurationView> {
        self.management_change("ai_provider_update", move |r| {
            r.update_provider(&validation::provider_update(input)?)
        })
        .await
    }
    pub(crate) async fn delete_provider(
        self: &Arc<Self>,
        input: AiProviderDeleteInput,
    ) -> AppResult<AiConfigurationView> {
        self.management_change("ai_provider_delete", move |r| r.delete_provider(&input))
            .await
    }
    pub(crate) async fn save_key(
        self: &Arc<Self>,
        input: AiKeySaveInput,
    ) -> AppResult<AiConfigurationView> {
        self.owned(Some("ai_key_save"), |s| async move {
            let (draft, secret) = KeyDraft::prepare(input)?;
            let checked = draft.clone();
            s.publish_management(
                secret,
                move |r| r.prepare_key(&checked),
                move |r, reference| r.save_key(&draft, reference.as_deref()),
            )
            .await
        })
        .await
    }
    pub(crate) async fn delete_key(
        self: &Arc<Self>,
        input: AiKeyDeleteInput,
    ) -> AppResult<AiConfigurationView> {
        self.management_change("ai_key_delete", move |r| r.delete_key(&input))
            .await
    }
    pub(crate) async fn save_model(
        self: &Arc<Self>,
        input: AiModelSaveInput,
    ) -> AppResult<AiConfigurationView> {
        self.management_change("ai_model_save", move |r| {
            r.save_model(&validation::model_save(input)?)
        })
        .await
    }
    pub(crate) async fn delete_model(
        self: &Arc<Self>,
        input: AiModelDeleteInput,
    ) -> AppResult<AiConfigurationView> {
        self.management_change("ai_model_delete", move |r| r.delete_model(&input))
            .await
    }
}
