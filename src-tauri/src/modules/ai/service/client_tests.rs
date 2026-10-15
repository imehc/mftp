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
    let error = provider_error(401);
    assert_eq!(error.code, "ai:provider_status");
    assert_eq!(error.args["status"], "401");
    assert_eq!(error.args.len(), 1);
}
