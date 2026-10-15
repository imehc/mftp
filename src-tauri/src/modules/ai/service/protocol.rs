use crate::error::{AppError, AppResult, CustomErrorCode};
use crate::modules::ai::completion::{
    AiCompletionRequest, AiOutput, AiProviderErrorCode, AiReasoningPolicy,
};
use crate::modules::ai::{AiConnectionConfig, AiProtocol};
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use serde_json::{json, Value};

#[path = "protocol/anthropic.rs"]
mod anthropic;
#[path = "protocol/chat.rs"]
mod chat;
#[path = "protocol/responses.rs"]
mod responses;
#[path = "protocol/usage.rs"]
mod usage;

pub(super) fn invalid() -> AppError {
    AiProviderErrorCode::Protocol.error()
}

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
    request: &AiCompletionRequest<'_>,
) -> Value {
    let text = request.text;
    let mut body = match config.protocol {
        AiProtocol::Responses => {
            json!({"model":config.model,"instructions":text.instructions,"input":text.input,"max_output_tokens":text.max_output_tokens})
        }
        AiProtocol::ChatCompletions => {
            json!({"model":config.model,"messages":[{"role":"system","content":text.instructions},{"role":"user","content":text.input}],"max_completion_tokens":text.max_output_tokens})
        }
        AiProtocol::AnthropicMessages => {
            json!({"model":config.model,"system":text.instructions,"messages":[{"role":"user","content":text.input}],"max_tokens":text.max_output_tokens})
        }
    };
    if request.streaming {
        body["stream"] = json!(true);
    }
    match request.reasoning {
        AiReasoningPolicy::ProviderDefault => {}
        AiReasoningPolicy::Responses { effort, summary } => {
            let mut reasoning = json!({});
            if let Some(effort) = effort {
                reasoning["effort"] = json!(effort);
            }
            if summary {
                reasoning["summary"] = json!("auto");
            }
            if reasoning.as_object().is_some_and(|value| !value.is_empty()) {
                body["reasoning"] = reasoning;
            }
        }
        AiReasoningPolicy::ChatCompletions { effort, .. } => {
            if let Some(effort) = effort {
                body["reasoning_effort"] = json!(effort);
            }
        }
        AiReasoningPolicy::Anthropic { budget_tokens } => {
            body["thinking"] = json!({"type":"enabled","budget_tokens":budget_tokens});
        }
    }
    body
}

pub(super) enum EventStatus {
    Ignored,
    Accepted,
    Completed,
}

pub(super) struct Adapter {
    protocol: AiProtocol,
    responses: responses::Responses,
    chat: chat::Chat,
    anthropic: anthropic::Anthropic,
}

impl Adapter {
    pub(super) fn new(protocol: AiProtocol, reasoning: AiReasoningPolicy) -> Self {
        Self {
            protocol,
            responses: responses::Responses::default(),
            chat: chat::Chat::new(reasoning),
            anthropic: anthropic::Anthropic::default(),
        }
    }

    pub(super) fn plain(&mut self, bytes: &[u8], output: &mut AiOutput<'_>) -> AppResult<()> {
        let value: Value = serde_json::from_slice(bytes).map_err(|_| invalid())?;
        if !value.is_object() {
            return Err(invalid());
        }
        if value.get("error").is_some_and(|value| !value.is_null()) {
            return Err(AiProviderErrorCode::Failed.error());
        }
        match self.protocol {
            AiProtocol::Responses => self.responses.plain(&value, output),
            AiProtocol::ChatCompletions => self.chat.plain(&value, output),
            AiProtocol::AnthropicMessages => self.anthropic.plain(&value, output),
        }
    }

    pub(super) fn event(
        &mut self,
        event: &str,
        data: &str,
        output: &mut AiOutput<'_>,
    ) -> AppResult<EventStatus> {
        if data.trim() == "[DONE]" {
            return if self.protocol == AiProtocol::ChatCompletions {
                self.chat.done()
            } else {
                Err(AiProviderErrorCode::Incomplete.error())
            };
        }
        let value: Value = serde_json::from_str(data).map_err(|_| invalid())?;
        if !value.is_object() {
            return Err(invalid());
        }
        let kind = value.get("type").and_then(Value::as_str).unwrap_or(event);
        if self.protocol != AiProtocol::ChatCompletions
            && !event.is_empty()
            && event != "message"
            && kind != event
        {
            return Err(invalid());
        }
        let status = match self.protocol {
            AiProtocol::Responses => self.responses.event(kind, &value, output),
            AiProtocol::ChatCompletions => self.chat.event(&value, output),
            AiProtocol::AnthropicMessages => self.anthropic.event(kind, &value, output),
        }?;
        if !matches!(status, EventStatus::Ignored) {
            output.observation.accepted_event();
        }
        Ok(status)
    }
}

fn index(value: &Value, name: &str) -> AppResult<u32> {
    value
        .get(name)
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .ok_or_else(invalid)
}

fn text<'a>(value: &'a Value, name: &str) -> AppResult<&'a str> {
    value.get(name).and_then(Value::as_str).ok_or_else(invalid)
}

#[cfg(test)]
pub(super) fn parse_output(protocol: AiProtocol, bytes: &[u8]) -> AppResult<String> {
    use crate::modules::ai::completion::{AiEmitter, AiObservation, AiTextRequest};
    let text = AiTextRequest {
        instructions: String::new(),
        input: String::new(),
        max_output_tokens: 32,
        output_limit_bytes: 1024 * 1024,
    };
    let request = AiCompletionRequest::text(&text, false);
    let observation = std::sync::Arc::new(AiObservation::new(protocol));
    let emitter = AiEmitter::new(observation.clone(), |_| {});
    let mut output = AiOutput::new(&request, observation, emitter);
    Adapter::new(protocol, request.reasoning).plain(bytes, &mut output)?;
    Ok(output.result()?.text.trim().into())
}

#[cfg(test)]
#[path = "protocol/adapter_tests.rs"]
mod tests;
