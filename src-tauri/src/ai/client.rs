use std::io::Read;
use std::time::Duration;

use eventsource_stream::Eventsource;
use futures_util::StreamExt;
use serde_json::{json, Value};

use crate::error::{AppError, AppResult};
use crate::poetry::model::PoemDetail;

use super::url::responses_endpoint;
use super::{AiConnectionConfig, AiTask, AiTaskRequest, PoetryTranslationResult};

const REQUEST_LIMIT_BYTES: usize = 128 * 1024;
const RESPONSE_LIMIT_BYTES: u64 = 1024 * 1024;
const TRANSLATION_LIMIT_BYTES: usize = 64 * 1024;
const STREAM_OUTPUT_LIMIT_BYTES: usize = TRANSLATION_LIMIT_BYTES + 1024;

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

pub async fn generate_poetry_translation<F>(
    config: &AiConnectionConfig,
    api_key: &str,
    task: AiTask,
    poem: &PoemDetail,
    mut on_delta: F,
) -> AppResult<PoetryTranslationResult>
where
    F: FnMut(String) + Send,
{
    let request = task.request(poem)?;
    let output = if config.streaming_enabled {
        send_streaming_text_request(
            config,
            api_key,
            &request,
            Duration::from_secs(90),
            |delta| {
                on_delta(delta.to_string());
                Ok(())
            },
        )
        .await?
    } else {
        send_text_request_async(
            config,
            api_key,
            request.instructions(),
            request.input(),
            request.max_output_tokens(),
            Duration::from_secs(90),
        )
        .await?
    };
    match request.task() {
        AiTask::PoetryTranslation { .. } => parse_translation_output(&output),
    }
}

async fn send_text_request_async(
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
        return Err(AppError("AI request exceeds the size limit".into()));
    }
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(timeout)
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("mftp-ai/1")
        .build()
        .map_err(|error| AppError(format!("Failed to create AI client: {error}")))?;
    let response = client
        .post(responses_endpoint(&config.base_url))
        .bearer_auth(api_key)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(body)
        .send()
        .await
        .map_err(request_error)?;
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
        return Err(AppError("AI request exceeds the size limit".into()));
    }

    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(timeout)
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
    parse_output_text(&bytes)
}

async fn send_streaming_text_request<F>(
    config: &AiConnectionConfig,
    api_key: &str,
    request: &AiTaskRequest,
    timeout: Duration,
    mut on_delta: F,
) -> AppResult<String>
where
    F: FnMut(&str) -> AppResult<()> + Send,
{
    let request = json!({
        "model": config.model,
        "instructions": request.instructions(),
        "input": request.input(),
        "max_output_tokens": request.max_output_tokens(),
        "stream": true,
    });
    let body = serde_json::to_vec(&request)?;
    if body.len() > REQUEST_LIMIT_BYTES {
        return Err(AppError("AI request exceeds the size limit".into()));
    }

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(timeout)
        // Redirects can silently move credentials or user content to another host.
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("mftp-ai/1")
        .build()
        .map_err(|error| AppError(format!("Failed to create AI client: {error}")))?;
    let response = client
        .post(responses_endpoint(&config.base_url))
        .bearer_auth(api_key)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(body)
        .send()
        .await
        .map_err(request_error)?;
    let status = response.status();
    if !status.is_success() {
        let bytes = read_limited_async(response).await?;
        return Err(provider_error(status.as_u16(), &bytes));
    }
    if response
        .content_length()
        .is_some_and(|length| length > RESPONSE_LIMIT_BYTES)
    {
        return Err(AppError(
            "AI provider response exceeds the size limit".into(),
        ));
    }

    let mut received = 0_u64;
    let byte_stream = response.bytes_stream().map(move |result| {
        let bytes = result.map_err(request_error)?;
        received += bytes.len() as u64;
        if received > RESPONSE_LIMIT_BYTES {
            Err(AppError(
                "AI provider response exceeds the size limit".into(),
            ))
        } else {
            Ok(bytes)
        }
    });
    let mut events = byte_stream.eventsource();
    let mut output = String::new();
    let mut completed = false;
    while let Some(event) = events.next().await {
        let event = event.map_err(|_| AppError("AI provider stream is invalid".into()))?;
        if handle_stream_event(&event.event, &event.data, &mut output, &mut on_delta)? {
            completed = true;
            break;
        }
    }
    if !completed {
        return Err(AppError(
            "AI provider returned an incomplete response".into(),
        ));
    }
    Ok(output)
}

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

async fn read_limited_async(response: reqwest::Response) -> AppResult<Vec<u8>> {
    if response
        .content_length()
        .is_some_and(|length| length > RESPONSE_LIMIT_BYTES)
    {
        return Err(AppError(
            "AI provider response exceeds the size limit".into(),
        ));
    }
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(request_error)?;
        if bytes.len() + chunk.len() > RESPONSE_LIMIT_BYTES as usize {
            return Err(AppError(
                "AI provider response exceeds the size limit".into(),
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

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

fn handle_stream_event<F>(
    event_name: &str,
    data: &str,
    output: &mut String,
    on_delta: &mut F,
) -> AppResult<bool>
where
    F: FnMut(&str) -> AppResult<()>,
{
    if data.trim() == "[DONE]" {
        return Ok(true);
    }
    let value: Value = serde_json::from_str(data)
        .map_err(|_| AppError("AI provider stream event is invalid JSON".into()))?;
    let event_type = value
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or(event_name);
    match event_type {
        "response.output_text.delta" => {
            let delta = value
                .get("delta")
                .and_then(Value::as_str)
                .ok_or_else(|| AppError("AI provider stream delta is invalid".into()))?;
            append_stream_text(output, delta, on_delta)?;
            Ok(false)
        }
        "response.output_text.done" => {
            if let Some(text) = value.get("text").and_then(Value::as_str) {
                reconcile_stream_text(output, text, on_delta)?;
            }
            Ok(false)
        }
        "response.completed" => {
            if let Some(response) = value.get("response") {
                let text = output_text_from_value(response);
                if !text.is_empty() {
                    reconcile_stream_text(output, &text, on_delta)?;
                }
            }
            Ok(true)
        }
        "response.failed" | "response.incomplete" | "error" => Err(AppError(
            "AI provider returned a failed stream event".into(),
        )),
        _ => Ok(false),
    }
}

fn append_stream_text<F>(output: &mut String, text: &str, on_delta: &mut F) -> AppResult<()>
where
    F: FnMut(&str) -> AppResult<()>,
{
    if output.len() + text.len() > STREAM_OUTPUT_LIMIT_BYTES {
        return Err(AppError("AI translation output is too long".into()));
    }
    output.push_str(text);
    on_delta(text)
}

fn reconcile_stream_text<F>(output: &mut String, text: &str, on_delta: &mut F) -> AppResult<()>
where
    F: FnMut(&str) -> AppResult<()>,
{
    if output.is_empty() {
        append_stream_text(output, text, on_delta)
    } else if output == text {
        Ok(())
    } else {
        Err(AppError("AI provider stream output is inconsistent".into()))
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

fn parse_translation_output(output: &str) -> AppResult<PoetryTranslationResult> {
    let output = strip_code_fence(output.trim());
    let translation = match serde_json::from_str::<Value>(output) {
        Ok(value) => value
            .as_object()
            .filter(|object| object.len() == 1)
            .and_then(|object| object.get("translation"))
            .and_then(Value::as_str)
            .ok_or_else(|| AppError("AI translation output has an invalid shape".into()))?
            .trim()
            .to_string(),
        Err(_) => output.to_string(),
    };
    if translation.is_empty() {
        return Err(AppError("AI translation output is empty".into()));
    }
    if translation.len() > TRANSLATION_LIMIT_BYTES {
        return Err(AppError("AI translation output is too long".into()));
    }
    Ok(PoetryTranslationResult { translation })
}

fn strip_code_fence(output: &str) -> &str {
    let Some(after_opening) = output.strip_prefix("```") else {
        return output;
    };
    let Some((_, body)) = after_opening.split_once('\n') else {
        return output;
    };
    body.strip_suffix("```").map(str::trim).unwrap_or(output)
}

#[cfg(test)]
#[path = "client_tests.rs"]
mod tests;
