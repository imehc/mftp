use std::io::{BufRead, BufReader, Read};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use serde_json::Value;

use super::input;
use super::model::{AgentSessionMessage, SessionAgent, SessionRole};
use super::text;
use super::transcript::{self, Transcript};
use crate::error::{AppError, AppResult, CustomErrorCode};

const MAX_LINE_BYTES: u64 = 32 * 1024 * 1024;
#[cfg(test)]
pub(super) fn visit(
    path: &Path,
    agent: SessionAgent,
    cancel: &AtomicBool,
    callback: impl FnMut(AgentSessionMessage, &[super::images::NativeImage<'_>]) -> AppResult<()>,
) -> AppResult<Transcript> {
    visit_prefix(path, agent, cancel, None, callback)
}

pub(super) fn visit_prefix(
    path: &Path,
    agent: SessionAgent,
    cancel: &AtomicBool,
    length: Option<u64>,
    mut callback: impl FnMut(AgentSessionMessage, &[super::images::NativeImage<'_>]) -> AppResult<()>,
) -> AppResult<Transcript> {
    // Read an immutable prefix: an agent may append complete or partial
    // records while this reader runs, without invalidating existing history.
    let mut reader = BufReader::new(input::open(path, length, cancel)?);
    let mut line = Vec::new();
    let mut first_id = None;
    let stem = path
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    let stem = if input::is_compressed(path) {
        stem.strip_suffix(".jsonl").unwrap_or(stem)
    } else {
        stem
    };
    let filename_id = if agent == SessionAgent::Codex {
        stem.get(stem.len().saturating_sub(36)..)
            .filter(|id| uuid::Uuid::parse_str(id).is_ok())
            .map(str::to_owned)
    } else {
        Some(stem.to_owned()).filter(|id| !id.is_empty())
    };
    let mut transcript = Transcript::default();
    loop {
        if cancel.load(Ordering::Acquire) {
            return Err(AppError::custom(CustomErrorCode::AgentSessionCancelled));
        }
        line.clear();
        let read = reader
            .by_ref()
            .take(MAX_LINE_BYTES + 1)
            .read_until(b'\n', &mut line)?;
        if read == 0 {
            break;
        }
        if read as u64 > MAX_LINE_BYTES {
            transcript.complete = false;
            // Discard only this oversized physical record, then resume at the
            // next newline without materializing its remaining contents.
            if !line.ends_with(b"\n") {
                loop {
                    if cancel.load(Ordering::Acquire) {
                        return Err(AppError::custom(CustomErrorCode::AgentSessionCancelled));
                    }
                    let buffer = reader.fill_buf()?;
                    if buffer.is_empty() {
                        break;
                    }
                    let end = buffer.iter().position(|byte| *byte == b'\n');
                    let length = end.map_or(buffer.len(), |end| end + 1);
                    reader.consume(length);
                    if end.is_some() {
                        break;
                    }
                }
            }
            continue;
        }
        let value: Value = match super::json::parse(&line, cancel) {
            Ok(value) => value,
            Err(error) if error.code == CustomErrorCode::AgentSessionCancelled.as_str() => {
                return Err(error)
            }
            Err(_) => {
                transcript.complete = false;
                continue;
            }
        };
        if agent == SessionAgent::Codex && value["type"] == "session_meta" {
            if let Some(id) = value["payload"]["id"].as_str() {
                if first_id.is_none() {
                    first_id = Some(id.to_owned());
                }
            }
        } else if agent != SessionAgent::Codex {
            if let Some(id) = value["sessionId"].as_str() {
                if first_id.is_none() {
                    first_id = Some(id.to_owned());
                }
            }
        }
        if transcript.cwd.is_empty() {
            transcript.cwd = value["cwd"]
                .as_str()
                .or(value["payload"]["cwd"].as_str())
                .unwrap_or_default()
                .into();
        }
        if value["isArchived"] == true
            || value["archived"] == true
            || (value["type"] == "session_meta" && value["payload"]["archived"] == true)
        {
            transcript.archived = true;
        }
        if value["type"] == "ai-title" {
            transcript.title = value["aiTitle"]
                .as_str()
                .map(text::safe_preview)
                .unwrap_or_default();
        }
        let model = match agent {
            SessionAgent::Claude => value["message"]["model"].as_str(),
            SessionAgent::Codex => value["payload"]["model"].as_str(),
            SessionAgent::Workbuddy => value["providerData"]["requestModelName"]
                .as_str()
                .or(value["providerData"]["model"].as_str()),
            _ => return Err(AppError::custom(CustomErrorCode::AgentSessionFormat)),
        };
        if let Some(model) = model.filter(|model| !model.trim().is_empty()) {
            transcript.model = Some(text::clip(model, 200));
        }
        let ts = text::timestamp(&value["timestamp"]);
        let mut messages = Vec::new();
        match agent {
            SessionAgent::Claude => claude(&value, ts, &mut messages),
            SessionAgent::Codex => codex(&value, ts, &mut messages),
            SessionAgent::Workbuddy => workbuddy(&value, ts, &mut messages),
            _ => return Err(AppError::custom(CustomErrorCode::AgentSessionFormat)),
        }
        let mut images = Vec::new();
        super::images::collect(&value, &mut images);
        if messages.is_empty() && !images.is_empty() {
            let role = value["role"]
                .as_str()
                .or(value["payload"]["role"].as_str())
                .unwrap_or("user");
            messages.push(AgentSessionMessage {
                index: 0,
                role: if role == "assistant" {
                    SessionRole::Assistant
                } else {
                    SessionRole::User
                },
                text: String::new(),
                timestamp: ts,
                truncated: false,
                model: None,
                images: Vec::new(),
                continuation: false,
            });
        }
        let image_message = messages
            .iter()
            .position(|message| matches!(message.role, SessionRole::User | SessionRole::Assistant))
            .unwrap_or(0);
        for (message_index, mut message) in messages.into_iter().enumerate() {
            if message.role == SessionRole::Assistant {
                message.model = transcript.model.clone();
            }
            let sources = if message_index == image_message {
                images.as_slice()
            } else {
                &[]
            };
            transcript::emit(&mut transcript, message, sources, cancel, &mut callback)?;
        }
    }
    // Per-record IDs can refer to imported history or subagents. The native
    // transcript filename owns identity; those references are not conflicts.
    transcript.id = filename_id.or(first_id).filter(|id| !id.trim().is_empty());
    if transcript.id.is_none() && agent != SessionAgent::Codex {
        transcript.id = path
            .file_stem()
            .and_then(|name| name.to_str())
            .filter(|name| !name.is_empty())
            .map(str::to_owned);
    }
    if transcript.title.is_empty() {
        transcript.title = transcript.preview.clone();
    }
    Ok(transcript)
}

fn push(messages: &mut Vec<AgentSessionMessage>, role: SessionRole, raw: String, ts: Option<f64>) {
    let message = transcript::message(role, raw, ts);
    if !message.text.trim().is_empty() {
        messages.push(message);
    }
}

fn claude(value: &Value, ts: Option<f64>, messages: &mut Vec<AgentSessionMessage>) {
    let kind = value["type"].as_str().unwrap_or_default();
    if kind == "user" && value["isMeta"] == true {
        return;
    }
    let role = match kind {
        "user" => SessionRole::User,
        "assistant" => SessionRole::Assistant,
        "system" => SessionRole::System,
        _ => return,
    };
    let content = if kind == "system" {
        &value["content"]
    } else {
        &value["message"]["content"]
    };
    if let Some(blocks) = content.as_array() {
        let mut parts = Vec::new();
        for block in blocks {
            match block["type"].as_str() {
                Some("text") => {
                    if let Some(text) = block["text"].as_str() {
                        parts.push(text);
                    }
                }
                Some("thinking") => push(
                    messages,
                    SessionRole::Thinking,
                    block["thinking"].as_str().unwrap_or_default().into(),
                    ts,
                ),
                Some("tool_use") => push(
                    messages,
                    SessionRole::Tool,
                    format!(
                        "{}\n{}",
                        block["name"].as_str().unwrap_or_default(),
                        block["input"]
                    ),
                    ts,
                ),
                Some("tool_result") => push(
                    messages,
                    SessionRole::Tool,
                    text::content(&block["content"]),
                    ts,
                ),
                _ => {}
            }
        }
        push(messages, role, parts.join("\n"), ts);
    } else {
        push(messages, role, text::content(content), ts);
    }
}

fn codex(value: &Value, ts: Option<f64>, messages: &mut Vec<AgentSessionMessage>) {
    // event_msg repeats the same prompt/answer as response_item. Reading the
    // canonical response stream keeps counts and match positions stable.
    if value["type"] != "response_item" {
        return;
    }
    let payload = &value["payload"];
    match payload["type"].as_str() {
        Some("message") => {
            let role = match payload["role"].as_str() {
                Some("user") => SessionRole::User,
                Some("assistant") => SessionRole::Assistant,
                _ => return,
            };
            push(messages, role, text::content(&payload["content"]), ts);
        }
        Some("function_call" | "custom_tool_call") => push(
            messages,
            SessionRole::Tool,
            format!(
                "{}\n{}",
                payload["name"].as_str().unwrap_or_default(),
                payload["arguments"]
                    .as_str()
                    .or(payload["input"].as_str())
                    .unwrap_or_default()
            ),
            ts,
        ),
        Some("function_call_output" | "custom_tool_call_output") => {
            let output = &payload["output"];
            let text = if output.is_string() || output.is_array() {
                text::content(output)
            } else {
                output.to_string()
            };
            push(messages, SessionRole::Tool, text, ts);
        }
        Some("reasoning") => push(
            messages,
            SessionRole::Thinking,
            text::content(&payload["summary"]),
            ts,
        ),
        _ => {}
    }
}

fn workbuddy(value: &Value, ts: Option<f64>, messages: &mut Vec<AgentSessionMessage>) {
    match value["type"].as_str() {
        Some("message") => {
            let role = match value["role"].as_str() {
                Some("user") => SessionRole::User,
                Some("assistant") => SessionRole::Assistant,
                Some("system") => SessionRole::System,
                _ => return,
            };
            push(messages, role, text::content(&value["content"]), ts);
        }
        Some("reasoning") => push(
            messages,
            SessionRole::Thinking,
            value["text"]
                .as_str()
                .or(value["content"].as_str())
                .unwrap_or_default()
                .into(),
            ts,
        ),
        Some("function_call") => push(
            messages,
            SessionRole::Tool,
            format!(
                "{}\n{}",
                value["name"].as_str().unwrap_or_default(),
                value["arguments"]
            ),
            ts,
        ),
        Some("function_call_result") => push(
            messages,
            SessionRole::Tool,
            value["output"]
                .as_str()
                .map(str::to_owned)
                .unwrap_or_else(|| value["output"].to_string()),
            ts,
        ),
        _ => {}
    }
}
