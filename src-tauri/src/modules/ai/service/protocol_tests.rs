use super::*;
use crate::modules::ai::AiProtocol;
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::TcpListener;

fn reply(protocol: AiProtocol) -> String {
    match protocol {
        AiProtocol::Responses => json!({"status":"completed","output":[{"content":[{"type":"output_text","text":"OK"}]}]}),
        AiProtocol::ChatCompletions => json!({"choices":[{"index":0,"finish_reason":"stop","message":{"content":"OK"}}]}),
        AiProtocol::AnthropicMessages => json!({"stop_reason":"end_turn","content":[{"type":"text","text":"OK"}]}),
    }.to_string()
}

fn stream(protocol: AiProtocol) -> String {
    let events = match protocol {
        AiProtocol::Responses => vec![
            json!({"type":"response.output_text.delta","output_index":0,"content_index":0,"delta":"OK"}),
            json!({"type":"response.completed","response":serde_json::from_str::<Value>(&reply(protocol)).unwrap()}),
        ],
        AiProtocol::ChatCompletions => vec![
            json!({"choices":[{"index":0,"delta":{"content":"OK"},"finish_reason":null}]}),
            json!({"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}),
        ],
        AiProtocol::AnthropicMessages => vec![
            json!({"type":"message_start","message":{"content":[]}}),
            json!({"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}),
            json!({"type":"ping"}),
            json!({"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"OK"}}),
            json!({"type":"content_block_stop","index":0}),
            json!({"type":"message_delta","delta":{"stop_reason":"end_turn"}}),
            json!({"type":"message_stop"}),
        ],
    };
    let mut body = events
        .into_iter()
        .map(|v| format!("data: {v}\n\n"))
        .collect::<String>();
    if protocol == AiProtocol::ChatCompletions {
        body.push_str("data: [DONE]\n\n");
    }
    body
}

fn server(body: String, status: u16) -> (String, std::thread::JoinHandle<(String, Value)>) {
    server_with_length(body, status, true)
}

fn server_with_length(
    body: String,
    status: u16,
    known_length: bool,
) -> (String, std::thread::JoinHandle<(String, Value)>) {
    server_delayed(body, status, known_length, Duration::ZERO)
}

fn server_delayed(
    body: String,
    status: u16,
    known_length: bool,
    delay: Duration,
) -> (String, std::thread::JoinHandle<(String, Value)>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/custom/v1", listener.local_addr().unwrap());
    let worker = std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(10)))
            .unwrap();
        let mut bytes = Vec::new();
        let (header, body_start, length) = loop {
            let mut chunk = [0; 4096];
            let size = socket.read(&mut chunk).unwrap();
            assert_ne!(size, 0);
            bytes.extend_from_slice(&chunk[..size]);
            if let Some(end) = bytes.windows(4).position(|s| s == b"\r\n\r\n") {
                let header = String::from_utf8(bytes[..end].to_vec()).unwrap();
                let length = header
                    .lines()
                    .find_map(|line| {
                        let (key, value) = line.split_once(':')?;
                        key.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse::<usize>().unwrap())
                    })
                    .unwrap();
                break (header, end + 4, length);
            }
        };
        while bytes.len() < body_start + length {
            let mut chunk = [0; 4096];
            let size = socket.read(&mut chunk).unwrap();
            assert_ne!(size, 0);
            bytes.extend_from_slice(&chunk[..size]);
        }
        let request = serde_json::from_slice(&bytes[body_start..body_start + length]).unwrap();
        std::thread::sleep(delay);
        let length_header = if known_length {
            format!("Content-Length: {}\r\n", body.len())
        } else {
            String::new()
        };
        let response = format!("HTTP/1.1 {status} Test\r\nContent-Type: text/event-stream\r\n{length_header}Connection: close\r\n\r\n{body}");
        // Split inside SSE frames so parsing must tolerate network chunk boundaries.
        for chunk in response
            .as_bytes()
            .chunks(if known_length { 17 } else { 4096 })
        {
            if socket.write_all(chunk).is_err() {
                break;
            }
        }
        (header, request)
    });
    (url, worker)
}

fn config(url: String, protocol: AiProtocol, streaming_enabled: bool) -> AiConnectionConfig {
    AiConnectionConfig {
        base_url: url,
        protocol,
        model: "test-model".into(),
        streaming_enabled,
    }
}

fn request() -> AiTextRequest {
    AiTextRequest {
        instructions: "instruction".into(),
        input: "input".into(),
        max_output_tokens: 32,
        output_limit_bytes: 1024,
    }
}

fn assert_request(protocol: AiProtocol, header: &str, body: &Value, streaming: bool) {
    let path = match protocol {
        AiProtocol::Responses => "responses",
        AiProtocol::ChatCompletions => "chat/completions",
        AiProtocol::AnthropicMessages => "messages",
    };
    assert!(header.starts_with(&format!("POST /custom/v1/{path} HTTP/1.1")));
    let header = header.to_lowercase();
    if protocol == AiProtocol::AnthropicMessages {
        assert!(header.contains("x-api-key: fake-key"));
        assert!(header.contains("anthropic-version: 2023-06-01"));
        assert!(!header.contains("authorization:"));
        assert_eq!(body["max_tokens"], 32);
        assert_eq!(body["system"], "instruction");
    } else {
        assert!(header.contains("authorization: bearer fake-key"));
        assert!(!header.contains("x-api-key:"));
        if protocol == AiProtocol::ChatCompletions {
            assert_eq!(body["max_completion_tokens"], 32);
            assert_eq!(body["messages"][0]["role"], "system");
        } else {
            assert_eq!(body["max_output_tokens"], 32);
        }
    }
    assert_eq!(body["stream"].as_bool().unwrap_or(false), streaming);
}

#[tokio::test]
async fn all_protocols_use_selected_wire_format_for_plain_and_streaming_requests() {
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
            let mut deltas = String::new();
            let result = generate_text_without_control(
                &config(url, protocol, streaming),
                "fake-key",
                &request(),
                |s| deltas.push_str(&s),
            )
            .await
            .unwrap();
            assert_eq!(result, "OK");
            assert_eq!(deltas, if streaming { "OK" } else { "" });
            let (header, body) = worker.join().unwrap();
            assert_request(protocol, &header, &body, streaming);
        }
    }
}

#[tokio::test]
async fn connection_probe_uses_each_selected_protocol() {
    for protocol in [
        AiProtocol::Responses,
        AiProtocol::ChatCompletions,
        AiProtocol::AnthropicMessages,
    ] {
        let (url, worker) = server(reply(protocol), 200);
        let report = test_connection(
            &config(url, protocol, false),
            "fake-key",
            AiProviderTestMode::NonStreaming,
        )
        .await;
        assert!(report.error.is_none(), "{report:?}");
        let (header, _) = worker.join().unwrap();
        let path = super::super::url::protocol_endpoint("http://local/custom/v1", protocol);
        assert!(header.starts_with(&format!(
            "POST {} HTTP/1.1",
            path.strip_prefix("http://local").unwrap()
        )));
    }
}

#[tokio::test]
async fn errors_disconnects_and_limits_do_not_publish_success() {
    for protocol in [
        AiProtocol::Responses,
        AiProtocol::ChatCompletions,
        AiProtocol::AnthropicMessages,
    ] {
        for (body, status, streaming, limit) in [
            (
                "{\"error\":{\"type\":\"denied\",\"message\":\"private-secret\"}}".to_string(),
                401,
                false,
                1024,
            ),
            ("invalid-json".to_string(), 200, false, 1024),
            (
                stream(protocol).split("\n\n").next().unwrap().to_string() + "\n\n",
                200,
                true,
                1024,
            ),
            (stream(protocol), 200, true, 1),
            (reply(protocol), 200, false, 1),
        ] {
            let (url, worker) = server(body, status);
            let mut request = request();
            request.output_limit_bytes = limit;
            let error = generate_text_without_control(
                &config(url, protocol, streaming),
                "fake-key",
                &request,
                |_| {},
            )
            .await
            .unwrap_err();
            assert!(!error.message.contains("private-secret"));
            worker.join().unwrap();
        }
    }
}

#[test]
fn truncated_empty_and_tool_outputs_are_rejected() {
    for (protocol, body) in [
        (
            AiProtocol::ChatCompletions,
            json!({"choices":[{"finish_reason":"length","message":{"content":"partial"}}]}),
        ),
        (
            AiProtocol::ChatCompletions,
            json!({"choices":[{"finish_reason":"tool_calls","message":{"content":""}}]}),
        ),
        (
            AiProtocol::AnthropicMessages,
            json!({"stop_reason":"max_tokens","content":[{"type":"text","text":"partial"}]}),
        ),
        (
            AiProtocol::AnthropicMessages,
            json!({"stop_reason":"end_turn","content":[]}),
        ),
    ] {
        assert!(protocol::parse_output(protocol, body.to_string().as_bytes()).is_err());
    }
}

#[tokio::test]
async fn cancelling_each_protocol_closes_the_stream_without_replaying() {
    for protocol in [
        AiProtocol::Responses,
        AiProtocol::ChatCompletions,
        AiProtocol::AnthropicMessages,
    ] {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let (ready, arrived) = tokio::sync::oneshot::channel();
        let worker = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut request = [0; 8192];
            assert!(socket.read(&mut request).unwrap() > 0);
            socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n").unwrap();
            ready.send(()).unwrap();
            // Drain any remaining request bytes; a dropped future must close the socket.
            // The client may abort with ECONNRESET instead of a clean EOF; both mean
            // the socket is closed, so read errors also end the drain loop.
            while matches!(socket.read(&mut request), Ok(n) if n > 0) {}
        });
        let task = tokio::spawn(async move {
            generate_text_without_control(
                &config(url, protocol, true),
                "fake-key",
                &request(),
                |_| {},
            )
            .await
        });
        arrived.await.unwrap();
        task.abort();
        assert!(task.await.unwrap_err().is_cancelled());
        worker.join().unwrap();
    }
}

#[path = "diagnostic_tests.rs"]
mod diagnostic_tests;

#[path = "runtime_tests.rs"]
mod runtime_tests;

#[path = "probe_tests.rs"]
mod probe_tests;

#[path = "transport_log_tests.rs"]
mod transport_log_tests;
