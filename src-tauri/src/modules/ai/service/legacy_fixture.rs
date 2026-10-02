//! Historical credential states used by migration and recovery regression tests.
//! This module and its DTOs are not compiled into application builds.
use super::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiConnection {
    pub base_url: String,
    pub model: String,
    pub streaming_enabled: bool,
    /// A saved credential reference exists; unlocking is deferred until use.
    pub has_key: bool,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiConnectionInput {
    pub base_url: String,
    pub model: String,
    #[serde(default = "default_streaming_enabled")]
    pub streaming_enabled: bool,
    /// None keeps the existing credential; Some replaces it.
    #[serde(default)]
    pub api_key: Option<String>,
}

fn default_streaming_enabled() -> bool {
    true
}

impl<C: AiCredentials + 'static> AiConfigurationService<C> {
    pub(crate) async fn get(self: &Arc<Self>) -> AppResult<AiConnection> {
        self.owned(None, |service| async move {
            service.recover_best_effort().await;
            let stored = service.db(|r| r.selected()).await?;
            // Browsing settings must not authenticate. Availability is checked
            // only when a request snapshot actually needs plaintext.
            let has_key = stored.reference.is_some();
            Ok(AiConnection {
                base_url: stored
                    .config
                    .as_ref()
                    .map(|c| c.base_url.clone())
                    .unwrap_or_default(),
                model: stored
                    .config
                    .as_ref()
                    .map(|c| c.model.clone())
                    .unwrap_or_default(),
                streaming_enabled: stored.streaming_enabled,
                has_key,
            })
        })
        .await
    }

    pub(crate) async fn save(
        self: &Arc<Self>,
        input: AiConnectionInput,
    ) -> AppResult<AiConnection> {
        self.owned(Some("ai_connection_save"), move |service| async move {
            let mut config = validate_connection(&input.base_url, &input.model)?;
            config.streaming_enabled = input.streaming_enabled;
            let secret = input.api_key.map(|s| s.trim().to_string());
            if secret
                .as_ref()
                .is_some_and(|s| s.is_empty() || s.len() > 16_384)
            {
                return Err(AppError::custom(CustomErrorCode::AiApiKeyInvalid));
            }
            service.recover_best_effort().await;
            let (replacement, adopt_default, has_key) = if let Some(secret) = secret {
                let reference = format!("ai-{}", uuid::Uuid::new_v4());
                let staged = reference.clone();
                service.db(move |r| r.stage_credential(&staged)).await?;
                if let Err(error) = service.credentials.save(reference.clone(), secret).await {
                    service.recover_best_effort().await;
                    return Err(error);
                }
                (Some(reference), false, true)
            } else {
                let base = config.base_url.clone();
                let target = service.db(move |r| r.target_reference(&base)).await?;
                let can_adopt = target.is_none() && service.db(|r| r.can_adopt_default()).await?;
                let has_key = if target.is_some() {
                    true
                } else if can_adopt {
                    // Legacy orphan adoption is the only metadata-save path
                    // that must establish whether a native credential exists.
                    service.credentials.read("default".into()).await?.is_some()
                } else {
                    false
                };
                (None, can_adopt && has_key, has_key)
            };
            let saved = config.clone();
            let result = service
                .db(move |r| r.publish_legacy(&saved, replacement.as_deref(), adopt_default))
                .await;
            // Both failed publication and retired references are durable until
            // cleanup succeeds; a cleanup failure never reverses committed data.
            service.recover_best_effort().await;
            result?;
            Ok(AiConnection {
                base_url: config.base_url,
                model: config.model,
                streaming_enabled: config.streaming_enabled,
                has_key,
            })
        })
        .await
    }

    pub(crate) async fn clear(self: &Arc<Self>) -> AppResult<AiConnection> {
        self.owned(Some("ai_connection_clear_key"), |service| async move {
            service.db(|r| r.clear_current_reference()).await?;
            service.recover_best_effort().await;
            let stored = service.db(|r| r.selected()).await?;
            Ok(AiConnection {
                base_url: stored
                    .config
                    .as_ref()
                    .map(|c| c.base_url.clone())
                    .unwrap_or_default(),
                model: stored.config.map(|c| c.model).unwrap_or_default(),
                streaming_enabled: stored.streaming_enabled,
                has_key: false,
            })
        })
        .await
    }
}
