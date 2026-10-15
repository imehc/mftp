use super::*;
use crate::modules::ai::completion::{
    AiCompletionResult, AiEmitter, AiObservation, AiReasoningEffort, AiStreamEvent,
    AiStreamEventPayload, AiTextRequest,
};
use parking_lot::Mutex;
use std::sync::Arc;

type Events = Arc<Mutex<Vec<AiStreamEvent>>>;

fn harness(
    protocol: AiProtocol,
    reasoning: AiReasoningPolicy,
    show: bool,
    limit: usize,
) -> (Adapter, AiOutput<'static>, Events) {
    let text = AiTextRequest {
        instructions: "instruction".into(),
        input: "input".into(),
        max_output_tokens: 4096,
        output_limit_bytes: limit,
    };
    let mut request = AiCompletionRequest::text(&text, true);
    request.reasoning = reasoning;
    request.show_reasoning = show;
    let observation = Arc::new(AiObservation::new(protocol));
    let events = Arc::new(Mutex::new(Vec::new()));
    let captured = events.clone();
    let emitter = AiEmitter::new(observation.clone(), move |event| {
        captured.lock().push(event)
    });
    (
        Adapter::new(protocol, reasoning),
        AiOutput::new(&request, observation, emitter),
        events,
    )
}

fn event(adapter: &mut Adapter, output: &mut AiOutput<'_>, value: Value) -> AppResult<EventStatus> {
    adapter.event("", &value.to_string(), output)
}

fn visible(events: &Events, reasoning: bool) -> String {
    events
        .lock()
        .iter()
        .filter_map(|event| match &event.payload {
            AiStreamEventPayload::ReasoningDelta { text, .. } if reasoning => Some(text.as_str()),
            AiStreamEventPayload::TextDelta { text, .. } if !reasoning => Some(text.as_str()),
            _ => None,
        })
        .collect()
}

fn plain(
    protocol: AiProtocol,
    value: Value,
    reasoning: AiReasoningPolicy,
) -> (AppResult<AiCompletionResult>, Events) {
    let (mut adapter, mut output, events) = harness(protocol, reasoning, true, 4096);
    let result = adapter
        .plain(value.to_string().as_bytes(), &mut output)
        .and_then(|_| output.result());
    (result, events)
}

#[test]
fn responses_summaries_and_multiple_text_blocks_stay_separate() {
    let (mut adapter, mut output, events) = harness(
        AiProtocol::Responses,
        AiReasoningPolicy::ProviderDefault,
        true,
        4096,
    );
    event(&mut adapter, &mut output, json!({"type":"response.reasoning_summary_text.delta","output_index":0,"summary_index":0,"delta":"summary"})).unwrap();
    event(&mut adapter, &mut output, json!({"type":"response.reasoning_summary_text.done","output_index":0,"summary_index":0,"text":"summary"})).unwrap();
    for (index, text) in [(0, "first"), (1, "second")] {
        event(&mut adapter, &mut output, json!({"type":"response.output_text.delta","output_index":1,"content_index":index,"delta":text})).unwrap();
    }
    let response = json!({"status":"completed","output":[
        {"type":"reasoning","summary":[{"type":"summary_text","text":"summary"}],"encrypted_content":"private-encrypted"},
        {"type":"message","content":[{"type":"output_text","text":"first"},{"type":"output_text","text":"second"}]}
    ],"usage":{"input_tokens":2,"output_tokens":8,"output_tokens_details":{"reasoning_tokens":3}}});
    assert!(matches!(
        event(
            &mut adapter,
            &mut output,
            json!({"type":"response.completed","response":response})
        )
        .unwrap(),
        EventStatus::Completed
    ));
    let result = output.result().unwrap();
    assert_eq!(result.text, "firstsecond");
    assert_eq!(result.usage.reasoning_tokens, Some(3));
    assert_eq!(visible(&events, true), "summary");
    assert_eq!(visible(&events, false), "firstsecond");
    assert!(!serde_json::to_string(&*events.lock())
        .unwrap()
        .contains("private-encrypted"));
}

#[test]
fn responses_done_sentinel_and_contradictory_completion_cannot_publish_success() {
    for value in [
        json!({"type":"response.completed"}),
        json!({"type":"response.completed","response":{"status":"incomplete","output":[]}}),
        json!({"type":"response.output_text.delta","delta":"no block identity"}),
    ] {
        let (mut adapter, mut output, _) = harness(
            AiProtocol::Responses,
            AiReasoningPolicy::ProviderDefault,
            true,
            4096,
        );
        assert_eq!(
            event(&mut adapter, &mut output, value).err().unwrap().code,
            "ai:provider_protocol"
        );
    }
    let (mut adapter, mut output, _) = harness(
        AiProtocol::Responses,
        AiReasoningPolicy::ProviderDefault,
        true,
        4096,
    );
    assert_eq!(
        adapter.event("", "[DONE]", &mut output).err().unwrap().code,
        "ai:provider_incomplete"
    );
}

#[test]
fn responses_final_text_must_match_all_streamed_blocks() {
    for final_text in ["different", ""] {
        let (mut adapter, mut output, _) = harness(
            AiProtocol::Responses,
            AiReasoningPolicy::ProviderDefault,
            true,
            4096,
        );
        event(&mut adapter, &mut output, json!({"type":"response.output_text.delta","output_index":0,"content_index":0,"delta":"text"})).unwrap();
        let output_value = if final_text.is_empty() {
            json!([])
        } else {
            json!([{"type":"message","content":[{"type":"output_text","text":final_text}]}])
        };
        assert_eq!(event(&mut adapter, &mut output, json!({"type":"response.completed","response":{"status":"completed","output":output_value}})).err().unwrap().code, "ai:provider_protocol");
    }
}

#[test]
fn output_done_can_supply_missing_deltas_but_not_override_existing_text() {
    for empty_delta in [false, true] {
        let (mut adapter, mut output, events) = harness(
            AiProtocol::Responses,
            AiReasoningPolicy::ProviderDefault,
            false,
            4096,
        );
        if empty_delta {
            event(&mut adapter, &mut output, json!({"type":"response.output_text.delta","output_index":0,"content_index":0,"delta":""})).unwrap();
        }
        event(&mut adapter, &mut output, json!({"type":"response.output_text.done","output_index":0,"content_index":0,"text":"fallback"})).unwrap();
        assert_eq!(visible(&events, false), "fallback");
        assert_eq!(event(&mut adapter, &mut output, json!({"type":"response.output_text.done","output_index":0,"content_index":0,"text":"changed"})).err().unwrap().code, "ai:provider_protocol");
    }
}

#[test]
fn redacted_thinking_observes_a_phase_without_visible_text_or_semantic_progress() {
    let (mut adapter, mut output, events) = harness(
        AiProtocol::AnthropicMessages,
        AiReasoningPolicy::ProviderDefault,
        true,
        4096,
    );
    event(
        &mut adapter,
        &mut output,
        json!({"type":"message_start","message":{"content":[]}}),
    )
    .unwrap();
    event(&mut adapter, &mut output, json!({"type":"content_block_start","index":0,"content_block":{"type":"redacted_thinking","data":"private-redacted"}})).unwrap();
    let diagnostics = output.observation.snapshot();
    assert_eq!(
        diagnostics.phase,
        crate::modules::ai::completion::AiObservedPhase::Reasoning
    );
    assert!(!diagnostics.had_reasoning_activity);
    assert_eq!(diagnostics.received_reasoning_bytes, 0);
    assert!(diagnostics.last_reasoning_progress_ms.is_none());
    assert_eq!(visible(&events, true), "");
    assert!(!serde_json::to_string(&*events.lock())
        .unwrap()
        .contains("private-redacted"));
}

#[test]
fn chat_reasoning_extensions_require_explicit_capability_and_never_split_think_tags() {
    for enabled in [false, true] {
        let reasoning = if enabled {
            AiReasoningPolicy::ChatCompletions {
                effort: None,
                reasoning_content: true,
            }
        } else {
            AiReasoningPolicy::ProviderDefault
        };
        let (result, events) = plain(
            AiProtocol::ChatCompletions,
            json!({"choices":[{"finish_reason":"stop","message":{"reasoning_content":"thought","content":"<think>literal</think>answer"}}]}),
            reasoning,
        );
        assert_eq!(result.unwrap().text, "<think>literal</think>answer");
        assert_eq!(visible(&events, true), if enabled { "thought" } else { "" });
    }
}

#[test]
fn chat_stream_requires_stop_before_done_and_rejects_post_stop_deltas() {
    let (mut adapter, mut output, _) = harness(
        AiProtocol::ChatCompletions,
        AiReasoningPolicy::ProviderDefault,
        false,
        4096,
    );
    assert_eq!(
        adapter.event("", "[DONE]", &mut output).err().unwrap().code,
        "ai:provider_incomplete"
    );
    event(
        &mut adapter,
        &mut output,
        json!({"choices":[{"index":0,"delta":{"content":"text"},"finish_reason":"stop"}]}),
    )
    .unwrap();
    assert_eq!(
        event(
            &mut adapter,
            &mut output,
            json!({"choices":[{"index":0,"delta":{"content":"late"}}]})
        )
        .err()
        .unwrap()
        .code,
        "ai:provider_protocol"
    );
    assert!(matches!(
        adapter.event("", "[DONE]", &mut output).unwrap(),
        EventStatus::Completed
    ));
}

#[test]
fn anthropic_thinking_signatures_and_redacted_blocks_do_not_enter_final_text() {
    let (result, events) = plain(
        AiProtocol::AnthropicMessages,
        json!({"stop_reason":"end_turn","content":[
            {"type":"thinking","thinking":"thought","signature":"private-signature"},
            {"type":"redacted_thinking","data":"private-redacted"},
            {"type":"text","text":"answer"}
        ]}),
        AiReasoningPolicy::ProviderDefault,
    );
    assert_eq!(result.unwrap().text, "answer");
    assert_eq!(visible(&events, true), "thought");
    assert!(!serde_json::to_string(&*events.lock())
        .unwrap()
        .contains("private-"));
}

#[test]
fn anthropic_multiple_thinking_blocks_do_not_complete_the_message() {
    let (mut adapter, mut output, events) = harness(
        AiProtocol::AnthropicMessages,
        AiReasoningPolicy::ProviderDefault,
        true,
        4096,
    );
    event(
        &mut adapter,
        &mut output,
        json!({"type":"message_start","message":{"content":[]}}),
    )
    .unwrap();
    for index in 0..2 {
        event(&mut adapter, &mut output, json!({"type":"content_block_start","index":index,"content_block":{"type":"thinking","thinking":""}})).unwrap();
        event(&mut adapter, &mut output, json!({"type":"content_block_delta","index":index,"delta":{"type":"thinking_delta","thinking":"thought"}})).unwrap();
        event(&mut adapter, &mut output, json!({"type":"content_block_delta","index":index,"delta":{"type":"signature_delta","signature":"private-signature"}})).unwrap();
        assert!(matches!(
            event(
                &mut adapter,
                &mut output,
                json!({"type":"content_block_stop","index":index})
            )
            .unwrap(),
            EventStatus::Accepted
        ));
    }
    event(&mut adapter, &mut output, json!({"type":"content_block_start","index":2,"content_block":{"type":"text","text":"answer"}})).unwrap();
    event(
        &mut adapter,
        &mut output,
        json!({"type":"content_block_stop","index":2}),
    )
    .unwrap();
    event(&mut adapter, &mut output, json!({"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}})).unwrap();
    assert!(matches!(
        event(&mut adapter, &mut output, json!({"type":"message_stop"})).unwrap(),
        EventStatus::Completed
    ));
    assert_eq!(output.result().unwrap().text, "answer");
    assert_eq!(visible(&events, true), "thoughtthought");
    assert!(!serde_json::to_string(&*events.lock())
        .unwrap()
        .contains("private-signature"));
}

#[test]
fn anthropic_mismatched_blocks_and_premature_stop_are_rejected() {
    for invalid_event in [
        json!({"type":"content_block_stop","index":1}),
        json!({"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"wrong kind"}}),
        json!({"type":"message_delta","delta":{"stop_reason":"end_turn"}}),
        json!({"type":"message_stop"}),
    ] {
        let (mut adapter, mut output, _) = harness(
            AiProtocol::AnthropicMessages,
            AiReasoningPolicy::ProviderDefault,
            true,
            4096,
        );
        event(
            &mut adapter,
            &mut output,
            json!({"type":"message_start","message":{"content":[]}}),
        )
        .unwrap();
        event(&mut adapter, &mut output, json!({"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}})).unwrap();
        assert!(event(&mut adapter, &mut output, invalid_event).is_err());
    }
}

#[test]
fn text_limits_are_enforced_before_publishing_oversized_deltas() {
    let (mut adapter, mut output, events) = harness(
        AiProtocol::Responses,
        AiReasoningPolicy::ProviderDefault,
        true,
        2,
    );
    assert_eq!(event(&mut adapter, &mut output, json!({"type":"response.output_text.delta","output_index":0,"content_index":0,"delta":"字"})).err().unwrap().code, "ai:output_too_large");
    assert_eq!(visible(&events, false), "");
}

#[test]
fn unknown_events_do_not_count_as_protocol_activity() {
    let (mut adapter, mut output, _) = harness(
        AiProtocol::Responses,
        AiReasoningPolicy::ProviderDefault,
        true,
        4096,
    );
    assert!(matches!(
        event(
            &mut adapter,
            &mut output,
            json!({"type":"vendor.unknown","data":"private"})
        )
        .unwrap(),
        EventStatus::Ignored
    ));
    assert!(output.observation.snapshot().first_event_ms.is_none());
}

#[test]
fn reasoning_request_parameters_are_explicit_and_protocol_specific() {
    let text = AiTextRequest {
        instructions: "instruction".into(),
        input: "input".into(),
        max_output_tokens: 4096,
        output_limit_bytes: 4096,
    };
    for protocol in [
        AiProtocol::Responses,
        AiProtocol::ChatCompletions,
        AiProtocol::AnthropicMessages,
    ] {
        let config = AiConnectionConfig {
            protocol,
            base_url: "https://example.invalid".into(),
            model: "reasoning-looking-name".into(),
            streaming_enabled: true,
        };
        let mut request = AiCompletionRequest::text(&text, true);
        let defaults = request_body(&config, &request);
        assert!(
            defaults.get("thinking").is_none()
                && defaults.get("reasoning").is_none()
                && defaults.get("reasoning_effort").is_none()
        );
        request.reasoning = match protocol {
            AiProtocol::Responses => AiReasoningPolicy::Responses {
                effort: Some(AiReasoningEffort::Low),
                summary: true,
            },
            AiProtocol::ChatCompletions => AiReasoningPolicy::ChatCompletions {
                effort: None,
                reasoning_content: true,
            },
            AiProtocol::AnthropicMessages => AiReasoningPolicy::Anthropic {
                budget_tokens: 1024,
            },
        };
        request.validate(protocol).unwrap();
        let body = request_body(&config, &request);
        match protocol {
            AiProtocol::Responses => {
                assert_eq!(body["reasoning"], json!({"effort":"low","summary":"auto"}))
            }
            AiProtocol::ChatCompletions => assert!(body.get("reasoning").is_none()),
            AiProtocol::AnthropicMessages => assert_eq!(
                body["thinking"],
                json!({"type":"enabled","budget_tokens":1024})
            ),
        }
    }
}
