use super::*;
use crate::modules::ai::AiProtocol;

#[test]
fn parses_responses_output_text() {
    let body = br#"{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"O"},{"type":"output_text","text":"K"}]}]}"#;
    assert_eq!(
        protocol::parse_output(AiProtocol::Responses, body).unwrap(),
        "OK"
    );
}

#[test]
fn rejects_incomplete_or_empty_responses() {
    for bytes in [
        br#"{"status":"incomplete","output":[]}"#.as_slice(),
        br#"{"status":"completed","output":[]}"#.as_slice(),
        b"not-json".as_slice(),
    ] {
        assert!(protocol::parse_output(AiProtocol::Responses, bytes).is_err());
    }
}

#[test]
fn provider_errors_expose_only_the_http_status() {
    for (status, code) in [
        (400, "ai:provider_request_rejected"),
        (401, "ai:provider_auth_rejected"),
        (403, "ai:provider_auth_rejected"),
        (404, "ai:provider_endpoint_not_found"),
        (422, "ai:provider_request_rejected"),
        (429, "ai:provider_rate_limited"),
        (500, "ai:provider_status"),
    ] {
        let error = provider_error(status);
        assert_eq!(error.code, code);
        assert_eq!(error.args["status"], status.to_string());
        assert_eq!(error.args.len(), 1);
    }
}
