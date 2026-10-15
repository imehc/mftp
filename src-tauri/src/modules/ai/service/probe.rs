use super::{runtime::complete_logged, url::protocol_endpoint};
use crate::modules::ai::{
    completion::{
        AiCompletionRequest, AiObservedPhase, AiStreamEventPayload, AiTextRequest, AiTimeoutPolicy,
        AiUsage,
    },
    configuration::testing::{
        AiProviderTestMode, AiProviderTestReport, AiProviderTestStatus, AiTestReasoningEvidence,
    },
    AiConnectionConfig,
};

#[cfg(test)]
pub(super) async fn test_connection(
    config: &AiConnectionConfig,
    api_key: &str,
    mode: AiProviderTestMode,
) -> AiProviderTestReport {
    run_probe(config, api_key, mode, AiTimeoutPolicy::default()).await
}

#[cfg(test)]
pub(super) async fn run_probe(
    config: &AiConnectionConfig,
    api_key: &str,
    mode: AiProviderTestMode,
    timeout: AiTimeoutPolicy,
) -> AiProviderTestReport {
    run_probe_logged(config, api_key, mode, timeout, None).await
}

pub(super) async fn run_probe_logged(
    config: &AiConnectionConfig,
    api_key: &str,
    mode: AiProviderTestMode,
    timeout: AiTimeoutPolicy,
    log: Option<&mut crate::core::diagnostics::DiagnosticRecorder>,
) -> AiProviderTestReport {
    let text = AiTextRequest {
        instructions: "Return a short plain-text answer.".into(),
        input: "Briefly confirm that you can respond.".into(),
        // Reasoning may consume the same budget as the final answer. Do not
        // force low effort or disable the provider's configured default.
        max_output_tokens: 4096,
        output_limit_bytes: 64 * 1024,
    };
    let mut request = AiCompletionRequest::text(&text, mode == AiProviderTestMode::Streaming);
    request.timeout = AiTimeoutPolicy {
        max_deadline_ms: timeout.hard_deadline_ms,
        ..timeout
    };
    let mut diagnostics = None;
    let mut reasoning = AiTestReasoningEvidence::default();
    let mut usage = AiUsage::default();
    let mut elapsed_ms = 0;
    let result = complete_logged(
        config,
        api_key,
        &request,
        None,
        |event| {
            elapsed_ms = event.elapsed_ms;
            match event.payload {
                AiStreamEventPayload::PhaseChanged {
                    phase: AiObservedPhase::Reasoning,
                    ..
                } => reasoning.phase_observed = true,
                AiStreamEventPayload::Usage { usage: value } => {
                    usage = value;
                }
                AiStreamEventPayload::Completed {
                    diagnostics: value, ..
                }
                | AiStreamEventPayload::Incomplete {
                    diagnostics: value, ..
                }
                | AiStreamEventPayload::Failed {
                    diagnostics: value, ..
                }
                | AiStreamEventPayload::Cancelled { diagnostics: value } => {
                    diagnostics = Some(value)
                }
                _ => {}
            }
        },
        log,
    )
    .await;
    if let Some(value) = &diagnostics {
        reasoning.activity_observed = value.had_reasoning_activity;
        reasoning.public_content_observed = value.received_reasoning_bytes > 0;
    }
    reasoning.reasoning_tokens = usage.reasoning_tokens;
    let status = if result.is_ok() {
        AiProviderTestStatus::Passed
    } else {
        AiProviderTestStatus::Failed
    };
    AiProviderTestReport {
        mode,
        protocol: config.protocol,
        endpoint: protocol_endpoint(&config.base_url, config.protocol),
        model: config.model.clone(),
        service_reachable: diagnostics
            .as_ref()
            .is_some_and(|value| value.response_started_ms.is_some()),
        non_streaming: if mode == AiProviderTestMode::NonStreaming {
            status
        } else {
            AiProviderTestStatus::NotTested
        },
        streaming: if mode == AiProviderTestMode::Streaming {
            if result.is_ok()
                && diagnostics
                    .as_ref()
                    .is_none_or(|value| value.stream_text_delta_count == 0)
            {
                AiProviderTestStatus::Unverified
            } else {
                status
            }
        } else {
            AiProviderTestStatus::NotTested
        },
        reasoning,
        usage,
        elapsed_ms,
        diagnostics,
        error: result.err(),
    }
}
