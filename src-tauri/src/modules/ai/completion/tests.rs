use super::events::{AiContentBlock, AiReasoningKind, AiStreamEventPayload};
use super::*;
use crate::error::AppErrorKind;
use crate::modules::ai::AiProtocol;
use serde_json::json;

#[test]
fn error_codes_are_stable_and_finish_reasons_cannot_echo_provider_data() {
    for code in [
        AiProviderErrorCode::Timeout,
        AiProviderErrorCode::RequestPolicy,
        AiProviderErrorCode::Cancelled,
        AiProviderErrorCode::OutputInvalid,
        AiProviderErrorCode::ConnectionTimeout,
        AiProviderErrorCode::FirstEventTimeout,
        AiProviderErrorCode::StreamIdle,
        AiProviderErrorCode::ProgressTimeout,
        AiProviderErrorCode::Incomplete,
        AiProviderErrorCode::NoText,
        AiProviderErrorCode::LimitReached,
        AiProviderErrorCode::Protocol,
        AiProviderErrorCode::Status,
        AiProviderErrorCode::Failed,
    ] {
        let error = code.with_finish_reason(Some("private provider output / secret key"));
        assert_eq!(error.kind, AppErrorKind::External);
        assert_eq!(json!(code), error.code);
        assert_eq!(error.args["finishReason"], "unknown");
        assert!(!serde_json::to_string(&error).unwrap().contains("private"));
        assert!(!format!("{error:?}").contains("secret"));
    }
}

#[test]
fn timeout_stages_do_not_depend_on_error_message_text() {
    for (stage, code, name) in [
        (
            AiTimeoutStage::Connection,
            "ai:provider_connection_timeout",
            "connection",
        ),
        (
            AiTimeoutStage::FirstEvent,
            "ai:provider_first_event_timeout",
            "firstEvent",
        ),
        (
            AiTimeoutStage::TransportIdle,
            "ai:provider_stream_idle",
            "transportIdle",
        ),
        (
            AiTimeoutStage::ReasoningProgress,
            "ai:provider_progress_timeout",
            "reasoningProgress",
        ),
        (
            AiTimeoutStage::TextProgress,
            "ai:provider_progress_timeout",
            "textProgress",
        ),
        (
            AiTimeoutStage::UnobservedProgress,
            "ai:provider_progress_timeout",
            "unobservedProgress",
        ),
        (
            AiTimeoutStage::HardDeadline,
            "ai:provider_timeout",
            "hardDeadline",
        ),
    ] {
        let error = AiProviderErrorCode::timeout(stage);
        assert_eq!(error.code, code);
        assert_eq!(error.args["timeoutStage"], name);
        assert_eq!(json!(stage), name);
    }
}

#[test]
fn transport_activity_does_not_claim_reasoning_or_text_progress() {
    let observation = AiObservation::new(AiProtocol::Responses);
    observation.response_started();
    observation.received(42);
    observation.text(0);
    let snapshot = observation.snapshot();
    assert_eq!(snapshot.phase, AiObservedPhase::Waiting);
    assert_eq!(snapshot.received_bytes, 42);
    assert!(snapshot.last_transport_activity_ms.is_none());
    observation.accepted_event();
    assert!(observation.snapshot().last_transport_activity_ms.is_some());
    assert_eq!(snapshot.last_text_progress_ms, None);
    assert_eq!(snapshot.last_reasoning_progress_ms, None);
    assert!(!snapshot.had_reasoning_activity);
}

#[test]
fn diagnostics_contain_only_allowlisted_metadata_and_preserve_error_identity() {
    let observation = AiObservation::new(AiProtocol::AnthropicMessages);
    observation.response_started();
    observation.received(96);
    observation.text("正文".len());
    let before = AiProviderErrorCode::LimitReached.with_finish_reason(Some("max_tokens"));
    let after = observation.annotate(before.clone());
    assert_eq!(after.kind, before.kind);
    assert_eq!(after.code, before.code);
    assert_eq!(after.args["finishReason"], "length");
    assert_eq!(after.args["phase"], "text");
    assert_eq!(after.args["receivedTextBytes"], "6");
    assert_eq!(after.args["hadReasoningActivity"], "false");
    let snapshot = serde_json::to_value(observation.snapshot()).unwrap();
    assert_eq!(
        snapshot
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        vec![
            "elapsedMs",
            "finishReason",
            "firstEventMs",
            "hadReasoningActivity",
            "hardDeadlineMs",
            "lastReasoningProgressMs",
            "lastTextProgressMs",
            "lastTransportActivityMs",
            "phase",
            "phaseStartedMs",
            "protocol",
            "receivedBytes",
            "receivedReasoningBytes",
            "receivedTextBytes",
            "responseStartedMs",
            "streamTextDeltaCount",
        ]
    );
    assert!(!snapshot.to_string().contains("正文"));
}

#[test]
fn diagnostics_saturate_instead_of_wrapping_counters() {
    let observation = AiObservation::new(AiProtocol::ChatCompletions);
    observation.received(usize::MAX);
    observation.received(100);
    observation.text(usize::MAX);
    observation.text(100);
    let snapshot = observation.snapshot();
    assert_eq!(snapshot.received_bytes, u32::MAX);
    assert_eq!(snapshot.received_text_bytes, u32::MAX);
}

#[test]
fn owner_event_contract_separates_reasoning_text_and_safe_diagnostics() {
    let event = AiStreamEvent {
        request_id: "00000000-0000-0000-0000-000000000001".into(),
        sequence: 7,
        elapsed_ms: 50,
        payload: AiStreamEventPayload::ReasoningDelta {
            block: AiContentBlock {
                output_index: 1,
                content_index: 0,
            },
            kind: AiReasoningKind::Summary,
            text: "private reasoning".into(),
        },
    };
    let value = serde_json::to_value(&event).unwrap();
    assert_eq!(
        value["payload"],
        json!({
            "type": "reasoningDelta", "block": {"outputIndex": 1, "contentIndex": 0},
            "kind": "summary", "text": "private reasoning",
        })
    );
    assert_eq!(value["requestId"], event.request_id);
    assert!(!format!("{event:?}").contains("private reasoning"));
    assert!(!format!("{event:?}").contains(&event.request_id));
    let completed = AiStreamEvent {
        payload: AiStreamEventPayload::Completed {
            finish_reason: AiFinishReason::Stop,
            diagnostics: AiObservation::new(AiProtocol::Responses).snapshot(),
        },
        sequence: 8,
        ..event
    };
    let completed = serde_json::to_value(completed).unwrap();
    assert_eq!(completed["payload"]["finishReason"], "stop");
    assert!(completed["payload"].get("text").is_none());
    assert!(!completed.to_string().contains("private reasoning"));
}
