use super::*;
use crate::core::diagnostics::{
    DiagnosticBodyEnd, DiagnosticDetail, DiagnosticStatus, Diagnostics,
};
use crate::modules::ai::{completion::AiTimeoutPolicy, service::probe::run_probe_logged};

#[tokio::test]
async fn every_protocol_records_actual_request_and_unmodified_received_bytes() {
    for protocol in [
        AiProtocol::Responses,
        AiProtocol::ChatCompletions,
        AiProtocol::AnthropicMessages,
    ] {
        for streaming in [false, true] {
            let original = if streaming {
                stream(protocol)
            } else {
                reply(protocol)
            }
            .replace("OK", "真实结果");
            let (url, server) = server(original.clone(), 200);
            let hub = Diagnostics::default();
            let mut log = hub.begin("ai", "test", "model").unwrap();
            let report = run_probe_logged(
                &config(url, protocol, streaming),
                "fake-key",
                if streaming {
                    AiProviderTestMode::Streaming
                } else {
                    AiProviderTestMode::NonStreaming
                },
                AiTimeoutPolicy::default(),
                Some(&mut log),
            )
            .await;
            log.finish(report.error.as_ref());
            let (_, request) = server.join().unwrap();
            assert!(report.error.is_none());
            let operation = hub.snapshot(0).operations.unwrap().remove(0);
            assert_eq!(operation.status, DiagnosticStatus::Passed);
            let DiagnosticDetail::HttpRequest { body, headers, .. } = &operation.details[0] else {
                panic!("request missing")
            };
            assert_eq!(serde_json::from_str::<Value>(&body.text).unwrap(), request);
            assert!(headers
                .iter()
                .any(|header| header.redacted && header.value == "[REDACTED]"));
            let DiagnosticDetail::HttpResponse { body, status, .. } = &operation.details[1] else {
                panic!("response missing")
            };
            assert_eq!(*status, 200);
            assert!(body.text.contains("真实结果"));
            if streaming {
                assert!(original.starts_with(&body.text));
                assert_eq!(body.end, DiagnosticBodyEnd::ProtocolEnd);
            } else {
                assert_eq!(body.text, original);
                assert_eq!(body.end, DiagnosticBodyEnd::Complete);
            }
            assert!(!serde_json::to_string(&operation)
                .unwrap()
                .contains("fake-key"));
        }
    }
}

#[tokio::test]
async fn original_http_error_remains_visible_except_credentials_and_keeps_app_error() {
    let raw = "{ \"error\": \"bad fake-key\", \"password\":\"hidden\", \"status\":401 }";
    let (url, server) = server(raw.into(), 401);
    let hub = Diagnostics::default();
    let mut log = hub.begin("ai", "test", "model").unwrap();
    let report = run_probe_logged(
        &config(url, AiProtocol::Responses, false),
        "fake-key",
        AiProviderTestMode::NonStreaming,
        AiTimeoutPolicy::default(),
        Some(&mut log),
    )
    .await;
    log.finish(report.error.as_ref());
    server.join().unwrap();
    let operation = hub.snapshot(0).operations.unwrap().remove(0);
    assert_eq!(operation.error.unwrap().code, "ai:provider_status");
    let DiagnosticDetail::HttpResponse { body, .. } = &operation.details[1] else {
        panic!("response missing")
    };
    assert_eq!(
        body.text,
        "{ \"error\": \"bad [REDACTED]\", \"password\":\"[REDACTED]\", \"status\":401 }"
    );
    assert!(body.redacted);
}

#[tokio::test]
async fn malformed_response_is_preserved_while_business_result_stays_a_protocol_error() {
    let (url, server) = server("not JSON: remote failure".into(), 200);
    let hub = Diagnostics::default();
    let mut log = hub.begin("ai", "test", "model").unwrap();
    let report = run_probe_logged(
        &config(url, AiProtocol::Responses, false),
        "fake-key",
        AiProviderTestMode::NonStreaming,
        AiTimeoutPolicy::default(),
        Some(&mut log),
    )
    .await;
    log.finish(report.error.as_ref());
    server.join().unwrap();
    assert_eq!(report.error.unwrap().code, "ai:provider_protocol");
    let operation = hub.snapshot(0).operations.unwrap().remove(0);
    let DiagnosticDetail::HttpResponse { body, .. } = &operation.details[1] else {
        panic!("response missing")
    };
    assert_eq!(body.text, "not JSON: remote failure");
}

#[tokio::test]
async fn stalled_error_body_respects_deadline_and_cannot_replace_original_status() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let server = std::thread::spawn(move || {
        let deadline = std::time::Instant::now() + Duration::from_secs(3);
        let (mut socket, _) = loop {
            match listener.accept() {
                Ok(socket) => break socket,
                Err(error)
                    if error.kind() == std::io::ErrorKind::WouldBlock
                        && std::time::Instant::now() < deadline =>
                {
                    std::thread::sleep(Duration::from_millis(5))
                }
                Err(error) => panic!("test server accept failed: {error}"),
            }
        };
        socket.set_nonblocking(false).unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        let mut request = Vec::new();
        let mut chunk = [0; 4096];
        loop {
            let size = socket.read(&mut chunk).unwrap();
            assert_ne!(size, 0);
            request.extend_from_slice(&chunk[..size]);
            if let Some(end) = request.windows(4).position(|bytes| bytes == b"\r\n\r\n") {
                let header = String::from_utf8_lossy(&request[..end]);
                let length = header
                    .lines()
                    .find_map(|line| {
                        let (name, value) = line.split_once(':')?;
                        name.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse::<usize>().unwrap())
                    })
                    .unwrap();
                if request.len() >= end + 4 + length {
                    break;
                }
            }
        }
        socket.write_all(b"HTTP/1.1 429 Too Many Requests\r\nContent-Length: 1000\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{\"error\":\"slow server\"").unwrap();
        // Leave the body unfinished until the client drops it at its deadline.
        assert_eq!(socket.read(&mut chunk).unwrap(), 0);
    });
    let hub = Diagnostics::default();
    let mut log = hub.begin("ai", "test", "model").unwrap();
    let started = std::time::Instant::now();
    let report = run_probe_logged(
        &config(url, AiProtocol::Responses, false),
        "fake-key",
        AiProviderTestMode::NonStreaming,
        AiTimeoutPolicy {
            soft_wait_ms: 25,
            hard_deadline_ms: 200,
            ..AiTimeoutPolicy::default()
        },
        Some(&mut log),
    )
    .await;
    assert!(started.elapsed() < Duration::from_millis(450));
    log.finish(report.error.as_ref());
    // Keep polling the runtime so Hyper can close its transport after body drop.
    tokio::task::spawn_blocking(move || server.join().unwrap())
        .await
        .unwrap();
    assert_eq!(report.error.as_ref().unwrap().code, "ai:provider_status");
    assert_eq!(report.error.unwrap().args["status"], "429");
    let operation = hub.snapshot(0).operations.unwrap().remove(0);
    let DiagnosticDetail::HttpResponse { body, .. } = &operation.details[1] else {
        panic!("response missing")
    };
    assert_eq!(body.text, "{\"error\":\"slow server\"");
    assert_eq!(body.end, DiagnosticBodyEnd::Interrupted);
}
