use std::io::Read;
use std::time::Duration;

use eventsource_stream::Eventsource;
use futures_util::StreamExt;
use serde_json::Value;

use crate::error::{AppError, AppResult, CustomErrorCode};
use crate::modules::ai::AiConnectionConfig;

use super::url::protocol_endpoint;
#[path = "protocol.rs"]
mod protocol;
#[path = "responses.rs"]
mod responses;
#[cfg(test)]
use responses::{handle_stream_event, parse_output_text};

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
    let output = if config.streaming_enabled {
        send_streaming_text_request(config, api_key, request, Duration::from_secs(90), |delta| {
            on_delta(delta.to_string());
            Ok(())
        })
        .await
    } else {
        send_text_request_async(config, api_key, request, Duration::from_secs(90)).await
    }?;
    if output.len() > request.output_limit_bytes {
        return Err(AppError::custom(CustomErrorCode::AiOutputTooLarge));
    }
    Ok(output)
}

async fn send_text_request_async(
    config: &AiConnectionConfig,
    api_key: &str,
    request: &AiTextRequest,
    timeout: Duration,
) -> AppResult<String> {
    let body = protocol::request_body(
        config,
        &request.instructions,
        &request.input,
        request.max_output_tokens,
        false,
    );
    let body = serde_json::to_vec(&body)?;
    if body.len() > REQUEST_LIMIT_BYTES {
        return Err(AppError::custom(CustomErrorCode::AiRequestTooLarge));
    }
    let client = build_client(timeout)?;
    let response = client
        .post(protocol_endpoint(&config.base_url, config.protocol))
        .headers(protocol::headers(config.protocol, api_key)?)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(body)
        .send()
        .await?;
    let status = response.status();
    let bytes = read_limited_async(response).await?;
    if !status.is_success() {
        return Err(provider_error(status.as_u16(), &bytes));
    }
    protocol::parse_output(config.protocol, &bytes)
}

fn send_text_request(
    config: &AiConnectionConfig,
    api_key: &str,
    instructions: &str,
    input: &str,
    max_output_tokens: u32,
    timeout: Duration,
) -> AppResult<String> {
    let request = protocol::request_body(config, instructions, input, max_output_tokens, false);
    let body = serde_json::to_vec(&request)?;
    if body.len() > REQUEST_LIMIT_BYTES {
        return Err(AppError::custom(CustomErrorCode::AiRequestTooLarge));
    }

    let client = build_blocking_client(timeout)?;
    let mut response = client
        .post(protocol_endpoint(&config.base_url, config.protocol))
        .headers(protocol::headers(config.protocol, api_key)?)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(body)
        .send()?;
    let status = response.status();
    let bytes = read_limited(&mut response)?;
    if !status.is_success() {
        return Err(provider_error(status.as_u16(), &bytes));
    }
    protocol::parse_output(config.protocol, &bytes)
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
    let body = protocol::request_body(
        config,
        &request.instructions,
        &request.input,
        request.max_output_tokens,
        true,
    );
    let body = serde_json::to_vec(&body)?;
    if body.len() > REQUEST_LIMIT_BYTES {
        return Err(AppError::custom(CustomErrorCode::AiRequestTooLarge));
    }

    let client = build_client(timeout)?;
    let response = client
        .post(protocol_endpoint(&config.base_url, config.protocol))
        .headers(protocol::headers(config.protocol, api_key)?)
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
    let mut state = protocol::StreamState::default();
    while let Some(event) = events.next().await {
        let event = event.map_err(|_| {
            AppError::external("ai:provider_protocol", "AI provider stream is invalid")
        })?;
        if state.handle(
            config.protocol,
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
    protocol::nonempty(output)
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

#[cfg(test)]
#[path = "client_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "protocol_tests.rs"]
mod protocol_tests;
