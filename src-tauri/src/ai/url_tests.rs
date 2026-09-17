use super::*;

#[test]
fn accepts_https_and_loopback_http() {
    assert!(validate_connection("https://api.openai.com", "gpt-test").is_ok());
    assert!(validate_connection("http://127.0.0.1:11434/v1", "local").is_ok());
    assert!(validate_connection("http://[::1]:8080", "local").is_ok());
    assert!(validate_connection("http://localhost:8080", "local").is_ok());
}

#[test]
fn rejects_unsafe_service_addresses() {
    assert!(validate_connection("http://example.com", "model").is_err());
    assert!(validate_connection("https://token@example.com", "model").is_err());
    assert!(validate_connection("https://example.com?key=value", "model").is_err());
    assert!(validate_connection("file:///tmp/provider", "model").is_err());
}

#[test]
fn builds_responses_endpoint_without_duplicate_v1() {
    assert_eq!(
        responses_endpoint("https://api.openai.com"),
        "https://api.openai.com/v1/responses"
    );
    assert_eq!(
        responses_endpoint("http://localhost:11434/v1"),
        "http://localhost:11434/v1/responses"
    );
    assert_eq!(
        responses_endpoint("https://example.com/v1/responses"),
        "https://example.com/v1/responses"
    );
}
