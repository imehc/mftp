use super::*;
use crate::modules::ai::completion::AiCompletionRequest;
use crate::modules::ai::service::runtime::{complete, RESPONSE_LIMIT_BYTES};

#[tokio::test]
async fn http_errors_do_not_expose_any_provider_fields_in_either_request_mode() {
    let body = json!({"error": {
        "code": "private-key-in-code", "type": "private-type",
        "message": "private-message", "reasoning": "private-thinking"
    }})
    .to_string();
    for protocol in [
        AiProtocol::Responses,
        AiProtocol::ChatCompletions,
        AiProtocol::AnthropicMessages,
    ] {
        for streaming in [false, true] {
            let (url, worker) = server(body.clone(), 401);
            let error = generate_text_without_control(
                &config(url, protocol, streaming),
                "fake-key",
                &request(),
                |_| {},
            )
            .await
            .unwrap_err();
            assert_eq!(error.code, "ai:provider_status");
            assert_eq!(error.args["protocol"], protocol.as_str());
            assert_eq!(error.args["status"], "401");
            assert_eq!(error.args["phase"], "waiting");
            assert!(!serde_json::to_string(&error).unwrap().contains("private-"));
            assert!(!format!("{error:?}").contains("fake-key"));
            worker.join().unwrap();
        }
        let (url, worker) = server(body.clone(), 401);
        let connection = config(url, protocol, false);
        let error = test_connection(&connection, "fake-key", AiProviderTestMode::NonStreaming)
            .await
            .error
            .unwrap();
        assert_eq!(error.code, "ai:provider_status");
        assert!(!serde_json::to_string(&error).unwrap().contains("private-"));
        worker.join().unwrap();
    }
}

#[test]
fn incomplete_budget_empty_and_malformed_responses_have_distinct_codes() {
    for (protocol, body, code) in [
        (
            AiProtocol::Responses,
            json!({"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"}}),
            "ai:provider_limit_reached",
        ),
        (
            AiProtocol::Responses,
            json!({"status":"incomplete"}),
            "ai:provider_incomplete",
        ),
        (
            AiProtocol::Responses,
            json!({"status":"completed","output":[]}),
            "ai:provider_no_text",
        ),
        (
            AiProtocol::ChatCompletions,
            json!({"choices":[{"finish_reason":"length","message":{"content":"partial"}}]}),
            "ai:provider_limit_reached",
        ),
        (
            AiProtocol::ChatCompletions,
            json!({"choices":[{"finish_reason":"stop","message":{"content":" "}}]}),
            "ai:provider_no_text",
        ),
        (
            AiProtocol::AnthropicMessages,
            json!({"stop_reason":"max_tokens","content":[]}),
            "ai:provider_limit_reached",
        ),
        (
            AiProtocol::AnthropicMessages,
            json!({"stop_reason":"end_turn","content":[]}),
            "ai:provider_no_text",
        ),
    ] {
        let error = protocol::parse_output(protocol, body.to_string().as_bytes()).unwrap_err();
        assert_eq!(error.code, code);
    }
    for protocol in [
        AiProtocol::Responses,
        AiProtocol::ChatCompletions,
        AiProtocol::AnthropicMessages,
    ] {
        let error = protocol::parse_output(protocol, b"private-invalid-json").unwrap_err();
        assert_eq!(error.code, "ai:provider_protocol");
        assert!(!serde_json::to_string(&error)
            .unwrap()
            .contains("private-invalid-json"));
    }
}

#[tokio::test]
async fn incomplete_stream_preserves_text_counters_without_including_partial_output() {
    for protocol in [
        AiProtocol::Responses,
        AiProtocol::ChatCompletions,
        AiProtocol::AnthropicMessages,
    ] {
        let body = match protocol {
            AiProtocol::Responses => "data: {\"type\":\"response.output_text.delta\",\"output_index\":0,\"content_index\":0,\"delta\":\"private-partial\"}\n\n".to_string(),
            AiProtocol::ChatCompletions => "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"private-partial\"},\"finish_reason\":null}]}\n\n".to_string(),
            AiProtocol::AnthropicMessages => concat!(
                "data: {\"type\":\"message_start\",\"message\":{\"content\":[]}}\n\n",
                "data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n",
                "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"private-partial\"}}\n\n",
            ).to_string(),
        };
        let (url, worker) = server(body, 200);
        let error = generate_text_without_control(&config(url, protocol, true), "fake-key", &request(), |_| {})
            .await
            .unwrap_err();
        assert_eq!(error.code, "ai:provider_incomplete");
        assert_eq!(error.args["phase"], "text");
        assert_eq!(error.args["receivedTextBytes"], "15");
        assert!(error.args["receivedBytes"].parse::<u32>().unwrap() > 15);
        assert!(error.args.contains_key("lastTextProgressMs"));
        assert_eq!(error.args["hadReasoningActivity"], "false");
        assert!(!serde_json::to_string(&error)
            .unwrap()
            .contains("private-partial"));
        worker.join().unwrap();
    }
}

#[tokio::test]
async fn a_stream_timeout_retains_its_classification_and_closes_the_transport() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let worker = std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut received = [0; 8192];
        assert!(socket.read(&mut received).unwrap() > 0);
        socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\ndata: {\"type\":\"response.output_text.delta\",\"output_index\":0,\"content_index\":0,\"delta\":\"part\"}\n\n").unwrap();
        while socket.read(&mut received).unwrap() > 0 {}
    });
    let text = request();
    let mut completion = AiCompletionRequest::text(&text, true);
    completion.timeout.hard_deadline_ms = 250;
    completion.timeout.soft_wait_ms = 100;
    let error = complete(
        &config(url, AiProtocol::Responses, true),
        "fake-key",
        &completion,
        None,
        |_| {},
    )
    .await
    .unwrap_err();
    assert_eq!(error.code, "ai:provider_timeout");
    assert_eq!(error.args["timeoutStage"], "hardDeadline");
    assert_eq!(error.args["phase"], "text");
    // Let the HTTP driver's cleanup run while waiting for the server's EOF.
    tokio::task::spawn_blocking(move || worker.join().unwrap())
        .await
        .unwrap();
}

#[tokio::test]
async fn streaming_size_errors_survive_the_eventsource_transport_wrapper() {
    // No Content-Length: exercise the limit inside the SSE byte stream.
    let body = "data: {\"type\":\"ping\"}\n\n".repeat(RESPONSE_LIMIT_BYTES / 10);
    let (url, worker) = server_with_length(body, 200, false);
    let error = generate_text_without_control(
        &config(url, AiProtocol::Responses, true),
        "fake-key",
        &request(),
        |_| {},
    )
    .await
    .unwrap_err();
    assert_eq!(error.kind, crate::error::AppErrorKind::Custom, "{error:?}");
    assert_eq!(error.code, "ai:response_too_large");
    assert!(error.args["receivedBytes"].parse::<usize>().unwrap() > RESPONSE_LIMIT_BYTES);
    tokio::task::spawn_blocking(move || worker.join().unwrap())
        .await
        .unwrap();
}

#[test]
fn debug_output_never_contains_the_request_prompt() {
    let request = request();
    let debug = format!("{request:?}");
    assert!(!debug.contains(&request.instructions));
    assert!(!debug.contains(&request.input));
    assert!(debug.contains("output_limit_bytes"));
}
