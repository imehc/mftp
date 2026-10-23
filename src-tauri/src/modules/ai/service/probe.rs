use super::{runtime::complete_logged, url::protocol_endpoint};
use crate::modules::ai::{
    completion::{
        AiCompletionRequest, AiObservedPhase, AiStreamEventPayload, AiTextRequest, AiTimeoutPolicy,
        AiUsage,
    },
    configuration::testing::{
        AiProviderTestMode, AiProviderTestReport, AiProviderTestStatus, AiTestReasoningEvidence,
    },
    AiConnectionConfig, AiProtocol,
};

#[cfg(test)]
pub(super) async fn test_connection(
    config: &AiConnectionConfig,
    api_key: &str,
    mode: AiProviderTestMode,
) -> AiProviderTestReport {
    run_probe(config, api_key, mode, AiTimeoutPolicy::probe()).await
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
        // The smallest budget each protocol accepts: Responses rejects any
        // value below 16. A clipped answer still proves reachability, so the
        // probe treats a reached budget as success instead of paying for a
        // full generation.
        max_output_tokens: if config.protocol == AiProtocol::Responses {
            16
        } else {
            1
        },
        output_limit_bytes: 4 * 1024,
    };
    let streaming = mode == AiProviderTestMode::Streaming;
    let mut request = AiCompletionRequest::text(&text, streaming);
    request.timeout = AiTimeoutPolicy {
        max_deadline_ms: timeout.hard_deadline_ms,
        ..timeout
    };
    request.stop_at_first_event = streaming;
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
    // The probe asks for the smallest budget each protocol accepts, so a
    // reached budget, a clipped answer or an empty one all still prove the
    // endpoint, credential and model were accepted. A rate limit proves the
    // same. Only transport, status and protocol failures mean unreachable.
    let reachable = result.is_ok()
        || result.as_ref().is_err_and(|error| {
            matches!(
                error.code.as_str(),
                "ai:provider_rate_limited"
                    | "ai:provider_limit_reached"
                    | "ai:provider_incomplete"
                    | "ai:provider_no_text"
            )
        });
    let status = if reachable {
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
        // Stopping at the first accepted event is the verdict: a reasoning
        // model that spends its whole budget thinking still answered.
        streaming: if mode == AiProviderTestMode::Streaming {
            status
        } else {
            AiProviderTestStatus::NotTested
        },
        reasoning,
        usage,
        elapsed_ms,
        diagnostics,
        // A reachable verdict must not also report an operation failure.
        error: if reachable { None } else { result.err() },
    }
}
