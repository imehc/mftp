use super::*;
use crate::modules::ai::{
    completion::AiTimeoutPolicy,
    configuration::testing::{AiProviderTestMode, AiProviderTestStatus},
    service::probe::run_probe,
};

const PROTOCOLS: [AiProtocol; 3] = [
    AiProtocol::Responses,
    AiProtocol::ChatCompletions,
    AiProtocol::AnthropicMessages,
];
const MODES: [AiProviderTestMode; 2] = [
    AiProviderTestMode::NonStreaming,
    AiProviderTestMode::Streaming,
];

#[tokio::test]
async fn probes_use_each_wire_contract_and_only_validate_the_requested_mode() {
    for protocol in PROTOCOLS {
        for mode in MODES {
            let streaming = mode == AiProviderTestMode::Streaming;
            let body = if streaming {
                stream(protocol)
            } else {
                reply(protocol)
            };
            let (url, worker) = server(body.replace("OK", "收到"), 200);
            // The saved streaming preference must not select the probe mode.
            let connection = config(url.clone(), protocol, !streaming);
            let report = test_connection(&connection, "fake-key", mode).await;
            assert!(report.error.is_none(), "{report:?}");
            assert!(report.service_reachable);
            assert_eq!(report.protocol, protocol);
            assert_eq!(report.model, "test-model");
            assert_eq!(
                report.endpoint,
                super::super::super::url::protocol_endpoint(&url, protocol)
            );
            assert_eq!(
                report.non_streaming,
                if streaming {
                    AiProviderTestStatus::NotTested
                } else {
                    AiProviderTestStatus::Passed
                }
            );
            assert_eq!(
                report.streaming,
                if streaming {
                    AiProviderTestStatus::Passed
                } else {
                    AiProviderTestStatus::NotTested
                }
            );
            let diagnostics = report.diagnostics.as_ref().unwrap();
            assert_eq!(diagnostics.first_event_ms.is_some(), streaming);
            assert_eq!(diagnostics.stream_text_delta_count > 0, streaming);
            assert_eq!(diagnostics.hard_deadline_ms, 300_000);
            assert!(!report.reasoning.phase_observed);
            let serialized = serde_json::to_string(&report).unwrap();
            assert!(!serialized.contains("收到") && !serialized.contains("fake-key"));
            let (header, mut body) = worker.join().unwrap();
            assert_eq!(body["model"], "test-model");
            assert!(body.get("reasoning").is_none());
            assert!(body.get("reasoning_effort").is_none());
            assert!(body.get("thinking").is_none());
            let budget = match protocol {
                AiProtocol::Responses => "max_output_tokens",
                AiProtocol::ChatCompletions => "max_completion_tokens",
                AiProtocol::AnthropicMessages => "max_tokens",
            };
            assert_eq!(body[budget], 4096);
            let input = match protocol {
                AiProtocol::Responses => &body["input"],
                AiProtocol::ChatCompletions => &body["messages"][1]["content"],
                AiProtocol::AnthropicMessages => &body["messages"][0]["content"],
            };
            assert_eq!(input, "Briefly confirm that you can respond.");
            // Reuse endpoint/auth/stream assertions independently of probe policy.
            body[budget] = json!(32);
            body["system"] = json!("instruction");
            assert_request(protocol, &header, &body, streaming);
        }
    }
}

#[tokio::test]
async fn failures_preserve_reachability_without_echoing_provider_output() {
    for protocol in PROTOCOLS {
        for mode in MODES {
            for (body, status, code) in [
                ("private-error-body".into(), 401, "ai:provider_status"),
                (
                    if mode == AiProviderTestMode::Streaming {
                        "data: private-invalid-json\n\n".into()
                    } else {
                        "private-invalid-json".into()
                    },
                    200,
                    "ai:provider_protocol",
                ),
            ] {
                let (url, worker) = server(body, status);
                let report = test_connection(&config(url, protocol, true), "fake-key", mode).await;
                assert!(report.service_reachable);
                assert_eq!(report.error.as_ref().unwrap().code, code);
                let serialized = serde_json::to_string(&report).unwrap();
                assert!(!serialized.contains("private-") && !serialized.contains("fake-key"));
                assert_eq!(
                    if mode == AiProviderTestMode::Streaming {
                        report.streaming
                    } else {
                        report.non_streaming
                    },
                    AiProviderTestStatus::Failed
                );
                worker.join().unwrap();
            }
        }
        let body = stream(protocol).split("\n\n").next().unwrap().to_string() + "\n\n";
        let (url, worker) = server(body, 200);
        let report = test_connection(
            &config(url, protocol, true),
            "fake-key",
            AiProviderTestMode::Streaming,
        )
        .await;
        assert_eq!(report.streaming, AiProviderTestStatus::Failed);
        assert_eq!(report.error.unwrap().code, "ai:provider_incomplete");
        worker.join().unwrap();
    }
}

#[tokio::test]
async fn final_snapshot_without_real_deltas_does_not_certify_incremental_streaming() {
    let body = format!(
        "data: {}\n\n",
        json!({"type":"response.completed","response":serde_json::from_str::<Value>(&reply(AiProtocol::Responses)).unwrap()})
    );
    let (url, worker) = server(body, 200);
    let report = test_connection(
        &config(url, AiProtocol::Responses, true),
        "fake-key",
        AiProviderTestMode::Streaming,
    )
    .await;
    assert!(report.error.is_none());
    assert_eq!(report.streaming, AiProviderTestStatus::Unverified);
    assert_eq!(report.diagnostics.unwrap().stream_text_delta_count, 0);
    worker.join().unwrap();
}

#[tokio::test]
async fn reasoning_evidence_never_contains_public_text_or_opaque_provider_data() {
    for (protocol, body, public) in [
        (
            AiProtocol::Responses,
            json!({"status":"completed","usage":{"output_tokens_details":{"reasoning_tokens":1024}},"output":[{"type":"reasoning","summary":[{"type":"summary_text","text":"private-summary"}],"encrypted_content":"private-encrypted"},{"type":"message","content":[{"type":"output_text","text":"private-answer"}]}]}),
            true,
        ),
        (
            AiProtocol::AnthropicMessages,
            json!({"stop_reason":"end_turn","content":[{"type":"thinking","thinking":"private-thinking","signature":"private-signature"},{"type":"text","text":"private-answer"}]}),
            true,
        ),
        (
            AiProtocol::AnthropicMessages,
            json!({"stop_reason":"end_turn","content":[{"type":"redacted_thinking","data":"private-redacted"},{"type":"text","text":"private-answer"}]}),
            false,
        ),
    ] {
        let (url, worker) = server(body.to_string(), 200);
        let report = test_connection(
            &config(url, protocol, false),
            "fake-key",
            AiProviderTestMode::NonStreaming,
        )
        .await;
        assert!(report.error.is_none(), "{report:?}");
        assert!(report.reasoning.phase_observed);
        assert_eq!(report.reasoning.public_content_observed, public);
        assert_eq!(report.reasoning.activity_observed, public);
        if protocol == AiProtocol::Responses {
            assert_eq!(report.reasoning.reasoning_tokens, Some(1024));
        }
        assert!(!serde_json::to_string(&report).unwrap().contains("private-"));
        assert!(!format!("{report:?}").contains("private-"));
        worker.join().unwrap();
    }
}

#[tokio::test]
async fn hidden_or_unconfigured_reasoning_is_unobserved_instead_of_unsupported() {
    let body = json!({"choices":[{"finish_reason":"stop","message":{"content":"OK","reasoning_content":"private-extension"}}],"usage":{"completion_tokens_details":{"reasoning_tokens":2048}}});
    let (url, worker) = server(body.to_string(), 200);
    let report = test_connection(
        &config(url, AiProtocol::ChatCompletions, false),
        "fake-key",
        AiProviderTestMode::NonStreaming,
    )
    .await;
    assert!(report.error.is_none());
    assert!(!report.reasoning.phase_observed);
    assert!(!report.reasoning.public_content_observed);
    assert_eq!(report.reasoning.reasoning_tokens, Some(2048));
    worker.join().unwrap();
}

#[tokio::test]
async fn probe_timeout_is_a_structured_failure_and_does_not_claim_reachability() {
    let (url, worker) = server_delayed(
        reply(AiProtocol::Responses),
        200,
        true,
        Duration::from_millis(200),
    );
    let report = run_probe(
        &config(url, AiProtocol::Responses, false),
        "fake-key",
        AiProviderTestMode::NonStreaming,
        AiTimeoutPolicy {
            soft_wait_ms: 25,
            hard_deadline_ms: 75,
            ..Default::default()
        },
    )
    .await;
    assert!(!report.service_reachable);
    assert_eq!(report.non_streaming, AiProviderTestStatus::Failed);
    let error = report.error.unwrap();
    assert_eq!(error.code, "ai:provider_timeout");
    assert_eq!(error.args["timeoutStage"], "hardDeadline");
    tokio::task::spawn_blocking(move || worker.join().unwrap())
        .await
        .unwrap();
}
