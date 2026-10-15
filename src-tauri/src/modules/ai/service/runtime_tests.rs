use super::*;
use crate::modules::ai::completion::{
    AiCompletionRequest, AiControlMessage, AiOutputPolicy, AiProviderErrorCode,
    AiStreamEventPayload,
};
use crate::modules::ai::service::runtime::complete;

#[tokio::test]
async fn every_protocol_has_one_request_identity_ordered_events_and_one_terminal_event() {
    let mut request_ids = std::collections::HashSet::new();
    for protocol in [
        AiProtocol::Responses,
        AiProtocol::ChatCompletions,
        AiProtocol::AnthropicMessages,
    ] {
        for streaming in [false, true] {
            let (url, worker) = server(
                if streaming {
                    stream(protocol)
                } else {
                    reply(protocol)
                },
                200,
            );
            let text = request();
            let request = AiCompletionRequest::text(&text, streaming);
            let mut events = Vec::new();
            let result = complete(
                &config(url, protocol, streaming),
                "fake-key",
                &request,
                None,
                |event| events.push(event),
            )
            .await
            .unwrap();
            assert_eq!(result.text, "OK");
            assert!(matches!(
                events.first().unwrap().payload,
                AiStreamEventPayload::Started
            ));
            assert!(matches!(
                events.last().unwrap().payload,
                AiStreamEventPayload::Completed { .. }
            ));
            let id = events[0].request_id.clone();
            uuid::Uuid::parse_str(&id).unwrap();
            assert!(request_ids.insert(id.clone()));
            for (index, event) in events.iter().enumerate() {
                assert_eq!(event.sequence, index as u32);
                assert_eq!(event.request_id, id);
            }
            assert_eq!(
                events
                    .iter()
                    .filter(|event| matches!(event.payload, AiStreamEventPayload::Completed { .. }))
                    .count(),
                1
            );
            assert!(!serde_json::to_string(&result.diagnostics)
                .unwrap()
                .contains("fake-key"));
            worker.join().unwrap();
        }
    }
}

#[tokio::test]
async fn extending_a_slow_http_request_does_not_send_it_again() {
    let (url, worker) = server_delayed(
        reply(AiProtocol::Responses),
        200,
        true,
        Duration::from_millis(120),
    );
    let text = request();
    let mut request = AiCompletionRequest::text(&text, false);
    request.timeout.hard_deadline_ms = 80;
    request.timeout.soft_wait_ms = 20;
    let (sender, mut receiver) = tokio::sync::mpsc::channel(2);
    let mut events = Vec::new();
    let result = complete(
        &config(url, AiProtocol::Responses, false),
        "fake-key",
        &request,
        Some(&mut receiver),
        |event| {
            if matches!(event.payload, AiStreamEventPayload::SoftWait { .. }) {
                sender
                    .try_send(AiControlMessage::Extend { additional_ms: 200 })
                    .unwrap();
            }
            events.push(event);
        },
    )
    .await
    .unwrap();
    assert_eq!(result.text, "OK");
    assert_eq!(result.diagnostics.hard_deadline_ms, 280);
    assert_eq!(
        events
            .iter()
            .filter(|event| matches!(event.payload, AiStreamEventPayload::SoftWait { .. }))
            .count(),
        1
    );
    assert_eq!(
        events
            .iter()
            .filter(|event| matches!(event.payload, AiStreamEventPayload::DeadlineExtended { .. }))
            .count(),
        1
    );
    worker.join().unwrap();
}

#[tokio::test]
async fn explicit_cancellation_closes_each_protocol_without_a_success_event() {
    for protocol in [
        AiProtocol::Responses,
        AiProtocol::ChatCompletions,
        AiProtocol::AnthropicMessages,
    ] {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let worker = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut bytes = [0; 8192];
            assert!(socket.read(&mut bytes).unwrap() > 0);
            socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n").unwrap();
            while socket.read(&mut bytes).unwrap() > 0 {}
        });
        let text = request();
        let request = AiCompletionRequest::text(&text, true);
        let (sender, mut receiver) = tokio::sync::mpsc::channel(2);
        let mut events = Vec::new();
        let error = complete(
            &config(url, protocol, true),
            "fake-key",
            &request,
            Some(&mut receiver),
            |event| {
                if matches!(
                    event.payload,
                    AiStreamEventPayload::PhaseChanged {
                        phase: crate::modules::ai::completion::AiObservedPhase::Waiting,
                        ..
                    }
                ) {
                    sender.try_send(AiControlMessage::Cancel).unwrap();
                }
                events.push(event);
            },
        )
        .await
        .unwrap_err();
        assert_eq!(error.code, "ai:cancelled");
        assert!(matches!(
            events.last().unwrap().payload,
            AiStreamEventPayload::Cancelled { .. }
        ));
        assert!(!events
            .iter()
            .any(|event| matches!(event.payload, AiStreamEventPayload::Completed { .. })));
        tokio::task::spawn_blocking(move || worker.join().unwrap())
            .await
            .unwrap();
    }
}

#[tokio::test]
async fn failed_events_preserve_structured_error_kind_code_and_safe_args() {
    let (url, worker) = server(stream(AiProtocol::Responses), 200);
    let mut text = request();
    text.output_limit_bytes = 1;
    let request = AiCompletionRequest::text(&text, true);
    let mut events = Vec::new();
    let error = complete(
        &config(url, AiProtocol::Responses, true),
        "fake-key",
        &request,
        None,
        |event| events.push(event),
    )
    .await
    .unwrap_err();
    match &events.last().unwrap().payload {
        AiStreamEventPayload::Failed {
            error: event_error, ..
        } => assert_eq!(*event_error, error),
        _ => panic!("expected a failed event"),
    }
    assert_eq!(error.code, "ai:output_too_large");
    worker.join().unwrap();
}

#[tokio::test]
async fn complete_sse_comments_emit_only_content_free_heartbeats_for_each_protocol() {
    for protocol in [
        AiProtocol::Responses,
        AiProtocol::ChatCompletions,
        AiProtocol::AnthropicMessages,
    ] {
        let body = format!(": private-心跳\r\n\r\n{}", stream(protocol));
        let (url, worker) = server(body, 200);
        let text = request();
        let request = AiCompletionRequest::text(&text, true);
        let mut events = Vec::new();
        let result = complete(
            &config(url, protocol, true),
            "fake-key",
            &request,
            None,
            |event| events.push(event),
        )
        .await
        .unwrap();
        assert_eq!(result.text, "OK");
        assert!(events
            .iter()
            .any(|event| matches!(event.payload, AiStreamEventPayload::Heartbeat)));
        assert!(!serde_json::to_string(&events).unwrap().contains("private-"));
        worker.join().unwrap();
    }
}

#[tokio::test]
async fn structured_output_is_parsed_only_after_successful_protocol_completion() {
    for (policy, content, expected) in [
        (
            AiOutputPolicy::StructuredJson,
            "not-json",
            Err("ai:output_invalid"),
        ),
        (AiOutputPolicy::GameMove, "[]", Err("ai:output_invalid")),
        (AiOutputPolicy::StructuredJson, "[]", Ok("[]")),
        (AiOutputPolicy::GameMove, "{\"move\":1}", Ok("{\"move\":1}")),
    ] {
        let body = json!({"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":content}]}]}).to_string();
        let (url, worker) = server(body, 200);
        let text = request();
        let mut request = AiCompletionRequest::text(&text, false);
        request.output_policy = policy;
        let result = complete(
            &config(url, AiProtocol::Responses, false),
            "fake-key",
            &request,
            None,
            |_| {},
        )
        .await;
        match expected {
            Ok(text) => assert_eq!(result.unwrap().text, text),
            Err(code) => assert_eq!(result.unwrap_err().code, code),
        }
        worker.join().unwrap();
    }
}

#[test]
fn invalid_reasoning_and_timeout_policies_are_rejected_before_network_dispatch() {
    let text = request();
    let mut request = AiCompletionRequest::text(&text, true);
    request.reasoning = crate::modules::ai::completion::AiReasoningPolicy::Anthropic {
        budget_tokens: 1024,
    };
    assert_eq!(
        request.validate(AiProtocol::Responses).unwrap_err().code,
        AiProviderErrorCode::RequestPolicy.error().code
    );
    assert!(request.validate(AiProtocol::AnthropicMessages).is_err());
    request.reasoning = Default::default();
    request.timeout.soft_wait_ms = request.timeout.hard_deadline_ms + 1;
    assert!(request.validate(AiProtocol::Responses).is_err());
}

fn thinking_stream(protocol: AiProtocol, outcome: u8) -> String {
    let final_text = if outcome == 2 { "" } else { "结果" };
    let events = match protocol {
        AiProtocol::Responses => {
            let mut values = vec![
                json!({"type":"response.reasoning_summary_text.delta","output_index":0,"summary_index":0,"delta":"思考"}),
            ];
            if !final_text.is_empty() {
                values.push(json!({"type":"response.output_text.delta","output_index":1,"content_index":0,"delta":final_text}));
            }
            let mut output = vec![
                json!({"type":"reasoning","summary":[{"type":"summary_text","text":"思考"}],"encrypted_content":"private-encrypted"}),
            ];
            if !final_text.is_empty() {
                output.push(
                    json!({"type":"message","content":[{"type":"output_text","text":final_text}]}),
                );
            }
            values.push(if outcome == 1 {
                json!({"type":"response.incomplete","response":{"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"},"output":output}})
            } else { json!({"type":"response.completed","response":{"status":"completed","output":output}}) });
            values
        }
        AiProtocol::ChatCompletions => vec![
            json!({"choices":[{"index":0,"delta":{"reasoning_content":"思考"},"finish_reason":null}]}),
            json!({"choices":[{"index":0,"delta":{"content":final_text},"finish_reason":if outcome == 1 {"length"} else {"stop"}}]}),
        ],
        AiProtocol::AnthropicMessages => {
            let mut values = vec![
                json!({"type":"message_start","message":{"content":[]}}),
                json!({"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}),
                json!({"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"思考"}}),
                json!({"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"private-signature"}}),
                json!({"type":"content_block_stop","index":0}),
            ];
            if !final_text.is_empty() {
                values.push(json!({"type":"content_block_start","index":1,"content_block":{"type":"text","text":final_text}}));
                values.push(json!({"type":"content_block_stop","index":1}));
            }
            values.push(json!({"type":"message_delta","delta":{"stop_reason":if outcome == 1 {"max_tokens"} else {"end_turn"}}}));
            values.push(json!({"type":"message_stop"}));
            values
        }
    };
    let mut body = events
        .into_iter()
        .map(|value| format!("data: {value}\n\n"))
        .collect::<String>();
    if protocol == AiProtocol::ChatCompletions {
        body.push_str("data: [DONE]\n\n");
    }
    body
}

#[tokio::test]
async fn reasoning_streams_handle_completion_budget_and_no_text_across_chunk_boundaries() {
    use crate::modules::ai::completion::AiReasoningPolicy;
    for protocol in [
        AiProtocol::Responses,
        AiProtocol::ChatCompletions,
        AiProtocol::AnthropicMessages,
    ] {
        for show in [false, true] {
            for outcome in 0..3 {
                let (url, worker) = server(thinking_stream(protocol, outcome), 200);
                let mut text = request();
                text.max_output_tokens = 4096;
                let mut request = AiCompletionRequest::text(&text, true);
                request.show_reasoning = show;
                request.reasoning = match protocol {
                    AiProtocol::Responses => AiReasoningPolicy::Responses {
                        effort: None,
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
                let mut events = Vec::new();
                let result = complete(
                    &config(url, protocol, true),
                    "fake-key",
                    &request,
                    None,
                    |event| events.push(event),
                )
                .await;
                match outcome {
                    0 => {
                        let result = result.unwrap();
                        assert_eq!(result.text, "结果");
                        assert!(result.diagnostics.had_reasoning_activity);
                    }
                    1 => {
                        let error = result.unwrap_err();
                        assert_eq!(error.code, "ai:provider_limit_reached");
                        assert_eq!(error.args["hadReasoningActivity"], "true");
                    }
                    _ => assert_eq!(result.unwrap_err().code, "ai:provider_no_text"),
                }
                let reasoning = events
                    .iter()
                    .filter_map(|event| match &event.payload {
                        AiStreamEventPayload::ReasoningDelta { text, .. } => Some(text.as_str()),
                        _ => None,
                    })
                    .collect::<String>();
                assert_eq!(reasoning, if show { "思考" } else { "" });
                assert!(!serde_json::to_string(&events).unwrap().contains("private-"));
                if outcome != 0 {
                    assert!(!events.iter().any(|event| matches!(
                        event.payload,
                        AiStreamEventPayload::Completed { .. }
                    )));
                }
                worker.join().unwrap();
            }
        }
    }
}
