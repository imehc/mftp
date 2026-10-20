use super::runtime::complete;
use crate::error::AppResult;
pub(crate) use crate::modules::ai::completion::AiTextRequest;
use crate::modules::ai::completion::{AiCompletionRequest, AiControlMessage, AiStreamEventPayload};
use crate::modules::ai::AiConnectionConfig;
use tokio::sync::mpsc::Receiver;

/// Compatibility facade: poetry receives final text only, never reasoning
/// events. The caller's control channel lets a user-initiated cancel stop the
/// provider stream instead of only muting the UI.
pub async fn generate_text(
    config: &AiConnectionConfig,
    api_key: &str,
    request: &AiTextRequest,
    control: Option<&mut Receiver<AiControlMessage>>,
    mut on_delta: impl FnMut(String) + Send,
) -> AppResult<String> {
    let result = complete(
        config,
        api_key,
        &AiCompletionRequest::text(request, config.streaming_enabled),
        control,
        |event| {
            if config.streaming_enabled {
                if let AiStreamEventPayload::TextDelta { text, .. } = event.payload {
                    on_delta(text);
                }
            }
        },
    )
    .await?;
    Ok(if config.streaming_enabled {
        result.text
    } else {
        result.text.trim().to_string()
    })
}

/// Test-only convenience for call sites that do not exercise cancellation.
#[cfg(test)]
pub async fn generate_text_without_control(
    config: &AiConnectionConfig,
    api_key: &str,
    request: &AiTextRequest,
    on_delta: impl FnMut(String) + Send,
) -> AppResult<String> {
    generate_text(config, api_key, request, None, on_delta).await
}

#[cfg(test)]
use super::{protocol, runtime::provider_error};
#[cfg(test)]
use std::time::Duration;

#[cfg(test)]
#[path = "protocol_tests.rs"]
mod protocol_tests;
#[cfg(test)]
#[path = "client_tests.rs"]
mod tests;

#[cfg(test)]
use super::probe::test_connection;
#[cfg(test)]
use crate::modules::ai::configuration::testing::AiProviderTestMode;
