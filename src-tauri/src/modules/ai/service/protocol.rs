use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use serde_json::{json, Value};

use super::responses;
use crate::error::{AppError, AppResult, CustomErrorCode};
use crate::modules::ai::{AiConnectionConfig, AiProtocol};

pub(super) fn headers(protocol: AiProtocol, key: &str) -> AppResult<HeaderMap> {
    let mut headers = HeaderMap::new();
    let (name, value) = if protocol == AiProtocol::AnthropicMessages {
        headers.insert("anthropic-version", HeaderValue::from_static("2023-06-01"));
        ("x-api-key", key.to_string())
    } else {
        (AUTHORIZATION.as_str(), format!("Bearer {key}"))
    };
    let mut value = HeaderValue::from_str(&value)
        .map_err(|_| AppError::custom(CustomErrorCode::AiApiKeyInvalid))?;
    value.set_sensitive(true);
    headers.insert(name, value);
    Ok(headers)
}

pub(super) fn request_body(
    config: &AiConnectionConfig,
    instructions: &str,
    input: &str,
    limit: u32,
    stream: bool,
) -> Value {
    let mut body = match config.protocol {
        AiProtocol::Responses => json!({
            "model": config.model, "instructions": instructions, "input": input,
            "max_output_tokens": limit,
        }),
        AiProtocol::ChatCompletions => json!({
            "model": config.model,
            "messages": [{"role": "system", "content": instructions}, {"role": "user", "content": input}],
            "max_completion_tokens": limit,
        }),
        AiProtocol::AnthropicMessages => json!({
            "model": config.model, "system": instructions,
            "messages": [{"role": "user", "content": input}], "max_tokens": limit,
        }),
    };
    if stream {
        body["stream"] = json!(true);
    }
    body
}

fn invalid() -> AppError {
    AppError::external(
        "ai:provider_protocol",
        "AI provider returned invalid text data",
    )
}

fn failed() -> AppError {
    AppError::external(
        "ai:provider_failed",
        "AI provider did not complete the text response",
    )
}

pub(super) fn nonempty(output: String) -> AppResult<String> {
    if output.trim().is_empty() {
        Err(invalid())
    } else {
        Ok(output)
    }
}

fn successful_stop(protocol: AiProtocol, reason: Option<&str>) -> AppResult<()> {
    match (protocol, reason) {
        (AiProtocol::ChatCompletions, Some("stop"))
        | (AiProtocol::AnthropicMessages, Some("end_turn" | "stop_sequence")) => Ok(()),
        _ => Err(failed()),
    }
}

pub(super) fn parse_output(protocol: AiProtocol, bytes: &[u8]) -> AppResult<String> {
    if protocol == AiProtocol::Responses {
        return responses::parse_output_text(bytes);
    }
    let value: Value = serde_json::from_slice(bytes).map_err(|_| invalid())?;
    if value.get("error").is_some() {
        return Err(failed());
    }
    let output = match protocol {
        AiProtocol::ChatCompletions => {
            let choice = value.pointer("/choices/0").ok_or_else(invalid)?;
            successful_stop(
                protocol,
                choice.get("finish_reason").and_then(Value::as_str),
            )?;
            choice
                .pointer("/message/content")
                .and_then(Value::as_str)
                .ok_or_else(invalid)?
                .to_string()
        }
        AiProtocol::AnthropicMessages => {
            successful_stop(protocol, value.get("stop_reason").and_then(Value::as_str))?;
            let blocks = value
                .get("content")
                .and_then(Value::as_array)
                .ok_or_else(invalid)?;
            let mut output = String::new();
            for block in blocks {
                if block.get("type").and_then(Value::as_str) == Some("text") {
                    output.push_str(
                        block
                            .get("text")
                            .and_then(Value::as_str)
                            .ok_or_else(invalid)?,
                    );
                }
            }
            output
        }
        AiProtocol::Responses => return Err(invalid()),
    };
    nonempty(output.trim().to_string())
}

#[derive(Default)]
pub(super) struct StreamState {
    stopped: bool,
    started: bool,
    text_block: Option<u64>,
}

impl StreamState {
    pub(super) fn handle<F>(
        &mut self,
        protocol: AiProtocol,
        event: &str,
        data: &str,
        limit: usize,
        output: &mut String,
        on_delta: &mut F,
    ) -> AppResult<bool>
    where
        F: FnMut(&str) -> AppResult<()>,
    {
        if protocol == AiProtocol::Responses {
            return responses::handle_stream_event(event, data, limit, output, on_delta);
        }
        if protocol == AiProtocol::ChatCompletions && data.trim() == "[DONE]" {
            return if self.stopped {
                Ok(true)
            } else {
                Err(failed())
            };
        }
        let value: Value = serde_json::from_str(data).map_err(|_| invalid())?;
        if value.get("error").is_some() {
            return Err(failed());
        }
        if protocol == AiProtocol::ChatCompletions {
            let choices = value
                .get("choices")
                .and_then(Value::as_array)
                .ok_or_else(invalid)?;
            for choice in choices {
                if choice.get("index").and_then(Value::as_u64) != Some(0) {
                    continue;
                }
                if self.stopped {
                    return Err(invalid());
                }
                if let Some(text) = choice.pointer("/delta/content").filter(|v| !v.is_null()) {
                    responses::append_stream_text(
                        output,
                        text.as_str().ok_or_else(invalid)?,
                        limit,
                        on_delta,
                    )?;
                }
                if let Some(reason) = choice.get("finish_reason").filter(|v| !v.is_null()) {
                    successful_stop(protocol, reason.as_str())?;
                    self.stopped = true;
                }
            }
            return Ok(false);
        }
        let kind = value.get("type").and_then(Value::as_str).unwrap_or(event);
        match kind {
            "error" => return Err(failed()),
            "message_start" => {
                if self.started {
                    return Err(invalid());
                }
                self.started = true;
            }
            "content_block_start" => {
                if !self.started || self.stopped || self.text_block.is_some() {
                    return Err(invalid());
                }
                if value.pointer("/content_block/type").and_then(Value::as_str) == Some("text") {
                    self.text_block = Some(
                        value
                            .get("index")
                            .and_then(Value::as_u64)
                            .ok_or_else(invalid)?,
                    );
                    let text = value
                        .pointer("/content_block/text")
                        .and_then(Value::as_str)
                        .ok_or_else(invalid)?;
                    responses::append_stream_text(output, text, limit, on_delta)?;
                }
            }
            "content_block_delta"
                if value.pointer("/delta/type").and_then(Value::as_str) == Some("text_delta") =>
            {
                if self.stopped
                    || self.text_block.is_none()
                    || self.text_block != value.get("index").and_then(Value::as_u64)
                {
                    return Err(invalid());
                }
                let text = value
                    .pointer("/delta/text")
                    .and_then(Value::as_str)
                    .ok_or_else(invalid)?;
                responses::append_stream_text(output, text, limit, on_delta)?;
            }
            "content_block_stop"
                if self.text_block == value.get("index").and_then(Value::as_u64) =>
            {
                self.text_block = None;
            }
            "message_delta" => {
                if !self.started || self.text_block.is_some() {
                    return Err(invalid());
                }
                successful_stop(
                    protocol,
                    value.pointer("/delta/stop_reason").and_then(Value::as_str),
                )?;
                self.stopped = true;
            }
            "message_stop" => {
                return if self.stopped {
                    Ok(true)
                } else {
                    Err(failed())
                }
            }
            _ => {}
        }
        Ok(false)
    }
}
