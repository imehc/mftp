#[cfg(desktop)]
use std::io::Read;
#[cfg(desktop)]
use std::time::Duration;

#[cfg(desktop)]
use serde_json::{json, Value};

use crate::error::{AppError, AppResult};

#[cfg(desktop)]
use super::url::responses_endpoint;
use super::AiConnectionConfig;

#[cfg(desktop)]
const RESPONSE_LIMIT_BYTES: u64 = 1024 * 1024;

#[cfg(desktop)]
pub fn test_connection(config: &AiConnectionConfig, api_key: &str) -> AppResult<()> {
    let request = json!({
        "model": config.model,
        "input": "Reply with only OK.",
        "max_output_tokens": 16
    });
    let body = serde_json::to_vec(&request)?;
    if body.len() > 64 * 1024 {
        return Err(AppError("AI request exceeds the size limit".into()));
    }

    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        // Redirects can silently move credentials or user content to another host.
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("mftp-ai/1")
        .build()
        .map_err(|error| AppError(format!("Failed to create AI client: {error}")))?;
    let mut response = client
        .post(responses_endpoint(&config.base_url))
        .bearer_auth(api_key)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(body)
        .send()
        .map_err(request_error)?;
    let status = response.status();
    let bytes = read_limited(&mut response)?;
    if !status.is_success() {
        return Err(provider_error(status.as_u16(), &bytes));
    }
    parse_output_text(&bytes).map(|_| ())
}

#[cfg(not(desktop))]
pub fn test_connection(_config: &AiConnectionConfig, _api_key: &str) -> AppResult<()> {
    Err(AppError(
        "AI provider requests are not available on this platform yet".into(),
    ))
}

#[cfg(desktop)]
fn request_error(error: reqwest::Error) -> AppError {
    let category = if error.is_timeout() {
        "request timed out"
    } else if error.is_connect() {
        "connection failed"
    } else if error.is_redirect() {
        "redirect was refused"
    } else {
        "request failed"
    };
    AppError(format!("AI provider {category}"))
}

#[cfg(desktop)]
fn read_limited(response: &mut reqwest::blocking::Response) -> AppResult<Vec<u8>> {
    if response
        .content_length()
        .is_some_and(|length| length > RESPONSE_LIMIT_BYTES)
    {
        return Err(AppError(
            "AI provider response exceeds the size limit".into(),
        ));
    }
    let mut bytes = Vec::new();
    response
        .take(RESPONSE_LIMIT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| AppError("Failed to read the AI provider response".into()))?;
    if bytes.len() as u64 > RESPONSE_LIMIT_BYTES {
        return Err(AppError(
            "AI provider response exceeds the size limit".into(),
        ));
    }
    Ok(bytes)
}

#[cfg(desktop)]
fn provider_error(status: u16, bytes: &[u8]) -> AppError {
    let code = serde_json::from_slice::<Value>(bytes)
        .ok()
        .and_then(|value| {
            value
                .pointer("/error/code")
                .or_else(|| value.pointer("/error/type"))
                .and_then(Value::as_str)
                .map(|value| value.chars().take(80).collect::<String>())
        });
    match code {
        Some(code) => AppError(format!("AI provider returned HTTP {status} ({code})")),
        None => AppError(format!("AI provider returned HTTP {status}")),
    }
}

#[cfg(desktop)]
fn parse_output_text(bytes: &[u8]) -> AppResult<String> {
    let value: Value = serde_json::from_slice(bytes)
        .map_err(|_| AppError("AI provider returned invalid JSON".into()))?;
    if value
        .get("status")
        .and_then(Value::as_str)
        .is_some_and(|status| status != "completed")
    {
        return Err(AppError(
            "AI provider returned an incomplete response".into(),
        ));
    }
    let mut text = String::new();
    if let Some(output) = value.get("output").and_then(Value::as_array) {
        for item in output {
            let Some(content) = item.get("content").and_then(Value::as_array) else {
                continue;
            };
            for part in content {
                if part.get("type").and_then(Value::as_str) != Some("output_text") {
                    continue;
                }
                if let Some(part_text) = part.get("text").and_then(Value::as_str) {
                    text.push_str(part_text);
                }
            }
        }
    }
    let text = text.trim();
    if text.is_empty() {
        return Err(AppError(
            "AI provider response did not contain output text".into(),
        ));
    }
    Ok(text.to_string())
}

#[cfg(all(test, desktop))]
mod tests {
    use super::*;

    #[test]
    fn parses_responses_output_text() {
        let body = br#"{
            "status":"completed",
            "output":[{"content":[
                {"type":"output_text","text":"O"},
                {"type":"output_text","text":"K"}
            ]}]
        }"#;
        assert_eq!(parse_output_text(body).unwrap(), "OK");
    }

    #[test]
    fn rejects_incomplete_or_empty_responses() {
        assert!(parse_output_text(br#"{"status":"incomplete","output":[]}"#).is_err());
        assert!(parse_output_text(br#"{"status":"completed","output":[]}"#).is_err());
        assert!(parse_output_text(b"not-json").is_err());
    }

    #[test]
    fn provider_errors_expose_code_but_not_message() {
        let error = provider_error(
            401,
            br#"{"error":{"code":"invalid_api_key","message":"secret request content"}}"#,
        );
        assert!(error.0.contains("invalid_api_key"));
        assert!(!error.0.contains("secret request content"));
    }
}
