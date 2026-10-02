use std::io::Read;
use std::time::Duration;

use eventsource_stream::Eventsource;
use futures_util::StreamExt;
use serde_json::{json, Value};

use crate::error::{AppError, AppResult, CustomErrorCode};
use crate::modules::ai::AiConnectionConfig;

use super::url::responses_endpoint;

const REQUEST_LIMIT_BYTES: usize = 128 * 1024;
const RESPONSE_LIMIT_BYTES: u64 = 1024 * 1024;

/// Bounded provider request assembled by a calling feature module. The AI
/// layer never interprets `instructions`/`input` beyond the size limits.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AiTextRequest {
    pub instructions: String,
    pub input: String,
    pub max_output_tokens: u32,
    /// Output accumulation ceiling enforced while streaming deltas.
    pub output_limit_bytes: usize,
}

pub fn test_connection(config: &AiConnectionConfig, api_key: &str) -> AppResult<()> {
    send_text_request(
        config,
        api_key,
        "Return only the requested plain text.",
        "Reply with only OK.",
        16,
        Duration::from_secs(30),
    )
    .map(|_| ())
}

/// Runs one bounded text completion, streaming or not per connection config,
/// and returns the raw output text. Delta callbacks receive ordered chunks.
pub async fn generate_text<F>(
    config: &AiConnectionConfig,
    api_key: &str,
    request: &AiTextRequest,
    mut on_delta: F,
) -> AppResult<String>
where
    F: FnMut(String) + Send,
{
    if config.streaming_enabled {
        send_streaming_text_request(config, api_key, request, Duration::from_secs(90), |delta| {
            on_delta(delta.to_string());
            Ok(())
        })
        .await
    } else {
        send_text_request_async(config, api_key, request, Duration::from_secs(90)).await
    }
}

async fn send_text_request_async(
    config: &AiConnectionConfig,
    api_key: &str,
    request: &AiTextRequest,
    timeout: Duration,
) -> AppResult<String> {
    let body = json!({
        "model": config.model,
        "instructions": request.instructions,
        "input": request.input,
        "max_output_tokens": request.max_output_tokens,
    });
    let body = serde_json::to_vec(&body)?;
    if body.len() > REQUEST_LIMIT_BYTES {
        return Err(AppError::custom(CustomErrorCode::AiRequestTooLarge));
    }
    let client = build_client(timeout)?;
    let response = client
        .post(responses_endpoint(&config.base_url))
        .bearer_auth(api_key)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(body)
        .send()
        .await?;
    let status = response.status();
    let bytes = read_limited_async(response).await?;
    if !status.is_success() {
        return Err(provider_error(status.as_u16(), &bytes));
    }
    parse_output_text(&bytes)
}

fn send_text_request(
    config: &AiConnectionConfig,
    api_key: &str,
    instructions: &str,
    input: &str,
    max_output_tokens: u32,
    timeout: Duration,
) -> AppResult<String> {
    let request = json!({
        "model": config.model,
        "instructions": instructions,
        "input": input,
        "max_output_tokens": max_output_tokens,
    });
    let body = serde_json::to_vec(&request)?;
    if body.len() > REQUEST_LIMIT_BYTES {
        return Err(AppError::custom(CustomErrorCode::AiRequestTooLarge));
    }

    let client = build_blocking_client(timeout)?;
    let mut response = client
        .post(responses_endpoint(&config.base_url))
        .bearer_auth(api_key)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(body)
        .send()?;
    let status = response.status();
    let bytes = read_limited(&mut response)?;
    if !status.is_success() {
        return Err(provider_error(status.as_u16(), &bytes));
    }
    parse_output_text(&bytes)
}

fn build_client(timeout: Duration) -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(timeout)
        // Redirects can silently move credentials or user content to another host.
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("mftp-ai/1")
        .build()
        .map_err(AppError::from)
}

fn build_blocking_client(timeout: Duration) -> AppResult<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(timeout)
        // Redirects can silently move credentials or user content to another host.
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("mftp-ai/1")
        .build()
        .map_err(AppError::from)
}

async fn send_streaming_text_request<F>(
    config: &AiConnectionConfig,
    api_key: &str,
    request: &AiTextRequest,
    timeout: Duration,
    mut on_delta: F,
) -> AppResult<String>
where
    F: FnMut(&str) -> AppResult<()> + Send,
{
    let body = json!({
        "model": config.model,
        "instructions": request.instructions,
        "input": request.input,
        "max_output_tokens": request.max_output_tokens,
        "stream": true,
    });
    let body = serde_json::to_vec(&body)?;
    if body.len() > REQUEST_LIMIT_BYTES {
        return Err(AppError::custom(CustomErrorCode::AiRequestTooLarge));
    }

    let client = build_client(timeout)?;
    let response = client
        .post(responses_endpoint(&config.base_url))
        .bearer_auth(api_key)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(body)
        .send()
        .await?;
    let status = response.status();
    if !status.is_success() {
        let bytes = read_limited_async(response).await?;
        return Err(provider_error(status.as_u16(), &bytes));
    }
    if response
        .content_length()
        .is_some_and(|length| length > RESPONSE_LIMIT_BYTES)
    {
        return Err(AppError::custom(CustomErrorCode::AiResponseTooLarge));
    }

    let mut received = 0_u64;
    let output_limit = request.output_limit_bytes;
    let byte_stream = response.bytes_stream().map(move |result| {
        let bytes = result?;
        received += bytes.len() as u64;
        if received > RESPONSE_LIMIT_BYTES {
            Err(AppError::custom(CustomErrorCode::AiResponseTooLarge))
        } else {
            Ok(bytes)
        }
    });
    let mut events = byte_stream.eventsource();
    let mut output = String::new();
    let mut completed = false;
    while let Some(event) = events.next().await {
        let event = event.map_err(|_| {
            AppError::external("ai:provider_protocol", "AI provider stream is invalid")
        })?;
        if handle_stream_event(
            &event.event,
            &event.data,
            output_limit,
            &mut output,
            &mut on_delta,
        )? {
            completed = true;
            break;
        }
    }
    if !completed {
        return Err(AppError::external(
            "ai:provider_failed",
            "AI provider returned an incomplete response",
        ));
    }
    Ok(output)
}

fn read_limited(response: &mut reqwest::blocking::Response) -> AppResult<Vec<u8>> {
    if response
        .content_length()
        .is_some_and(|length| length > RESPONSE_LIMIT_BYTES)
    {
        return Err(AppError::custom(CustomErrorCode::AiResponseTooLarge));
    }
    let mut bytes = Vec::new();
    response
        .take(RESPONSE_LIMIT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| {
            AppError::from(error).context("Failed to read the AI provider response")
        })?;
    if bytes.len() as u64 > RESPONSE_LIMIT_BYTES {
        return Err(AppError::custom(CustomErrorCode::AiResponseTooLarge));
    }
    Ok(bytes)
}

async fn read_limited_async(response: reqwest::Response) -> AppResult<Vec<u8>> {
    if response
        .content_length()
        .is_some_and(|length| length > RESPONSE_LIMIT_BYTES)
    {
        return Err(AppError::custom(CustomErrorCode::AiResponseTooLarge));
    }
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        if bytes.len() + chunk.len() > RESPONSE_LIMIT_BYTES as usize {
            return Err(AppError::custom(CustomErrorCode::AiResponseTooLarge));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

fn provider_error(status: u16, bytes: &[u8]) -> AppError {
    // Only the machine-readable provider error code is exposed; the response
    // body may echo request content and must never pass through.
    let code = serde_json::from_slice::<Value>(bytes)
        .ok()
        .and_then(|value| {
            value
                .pointer("/error/code")
                .or_else(|| value.pointer("/error/type"))
                .and_then(Value::as_str)
                .map(|value| value.chars().take(80).collect::<String>())
        });
    let message = match code {
        Some(code) => format!("AI provider returned HTTP {status} ({code})"),
        None => format!("AI provider returned HTTP {status}"),
    };
    AppError::external("ai:provider_status", message)
}

fn parse_output_text(bytes: &[u8]) -> AppResult<String> {
    let value: Value = serde_json::from_slice(bytes)
        .map_err(|error| AppError::from(error).context("AI provider returned invalid JSON"))?;
    if value
        .get("status")
        .and_then(Value::as_str)
        .is_some_and(|status| status != "completed")
    {
        return Err(AppError::external(
            "ai:provider_failed",
            "AI provider returned an incomplete response",
        ));
    }
    let text = output_text_from_value(&value);
    let text = text.trim();
    if text.is_empty() {
        return Err(AppError::external(
            "ai:provider_protocol",
            "AI provider response did not contain output text",
        ));
    }
    Ok(text.to_string())
}

fn handle_stream_event<F>(
    event_name: &str,
    data: &str,
    output_limit_bytes: usize,
    output: &mut String,
    on_delta: &mut F,
) -> AppResult<bool>
where
    F: FnMut(&str) -> AppResult<()>,
{
    if data.trim() == "[DONE]" {
        return Ok(true);
    }
    let value: Value = serde_json::from_str(data).map_err(|error| {
        AppError::from(error).context("AI provider stream event is invalid JSON")
    })?;
    let event_type = value
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or(event_name);
    match event_type {
        "response.output_text.delta" => {
            let delta = value.get("delta").and_then(Value::as_str).ok_or_else(|| {
                AppError::external(
                    "ai:provider_protocol",
                    "AI provider stream delta is invalid",
                )
            })?;
            append_stream_text(output, delta, output_limit_bytes, on_delta)?;
            Ok(false)
        }
        "response.output_text.done" => {
            if let Some(text) = value.get("text").and_then(Value::as_str) {
                reconcile_stream_text(output, text, output_limit_bytes, on_delta)?;
            }
            Ok(false)
        }
        "response.completed" => {
            if let Some(response) = value.get("response") {
                let text = output_text_from_value(response);
                if !text.is_empty() {
                    reconcile_stream_text(output, &text, output_limit_bytes, on_delta)?;
                }
            }
            Ok(true)
        }
        "response.failed" | "response.incomplete" | "error" => Err(AppError::external(
            "ai:provider_failed",
            "AI provider returned a failed stream event",
        )),
        _ => Ok(false),
    }
}

fn append_stream_text<F>(
    output: &mut String,
    text: &str,
    output_limit_bytes: usize,
    on_delta: &mut F,
) -> AppResult<()>
where
    F: FnMut(&str) -> AppResult<()>,
{
    if output.len() + text.len() > output_limit_bytes {
        return Err(AppError::custom(CustomErrorCode::AiOutputTooLarge));
    }
    output.push_str(text);
    on_delta(text)
}

fn reconcile_stream_text<F>(
    output: &mut String,
    text: &str,
    output_limit_bytes: usize,
    on_delta: &mut F,
) -> AppResult<()>
where
    F: FnMut(&str) -> AppResult<()>,
{
    if output.is_empty() {
        append_stream_text(output, text, output_limit_bytes, on_delta)
    } else if output == text {
        Ok(())
    } else {
        Err(AppError::external(
            "ai:provider_protocol",
            "AI provider stream output is inconsistent",
        ))
    }
}

fn output_text_from_value(value: &Value) -> String {
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
    text
}

#[cfg(test)]
#[path = "client_tests.rs"]
mod tests;
