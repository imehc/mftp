use super::{index, invalid, text, usage, EventStatus};
use crate::error::AppResult;
use crate::modules::ai::{
    completion::{AiContentBlock, AiObservedPhase, AiOutput, AiProviderErrorCode, AiReasoningKind},
    AiProtocol,
};
use serde_json::Value;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    Text,
    Thinking,
    Redacted,
}

#[derive(Default)]
pub(super) struct Anthropic {
    started: bool,
    stopped: bool,
    active: Option<(u32, Kind)>,
    next_index: u32,
}

fn block(index: u32) -> AiContentBlock {
    AiContentBlock {
        output_index: 0,
        content_index: index,
    }
}

impl Anthropic {
    fn content(&self, value: &Value, index: u32, output: &mut AiOutput<'_>) -> AppResult<Kind> {
        match value.get("type").and_then(Value::as_str) {
            Some("text") => {
                output.text(block(index), text(value, "text")?)?;
                Ok(Kind::Text)
            }
            Some("thinking") => {
                output.reasoning(
                    block(index),
                    AiReasoningKind::VisibleThinking,
                    text(value, "thinking")?,
                    false,
                );
                Ok(Kind::Thinking)
            }
            Some("redacted_thinking") => {
                text(value, "data")?;
                output.phase(AiObservedPhase::Reasoning, Some(block(index)));
                Ok(Kind::Redacted)
            }
            Some("tool_use" | "server_tool_use") => {
                Err(AiProviderErrorCode::Failed.with_finish_reason(Some("tool_use")))
            }
            _ => Err(invalid()),
        }
    }

    fn finish(&self, reason: Option<&Value>, output: &AiOutput<'_>) -> AppResult<()> {
        let reason = reason.and_then(Value::as_str);
        if matches!(
            reason,
            Some("end_turn" | "stop_sequence" | "max_tokens" | "tool_use" | "refusal")
        ) {
            output.finish(reason)
        } else {
            Err(AiProviderErrorCode::Incomplete.with_finish_reason(reason))
        }
    }

    pub(super) fn plain(&self, value: &Value, output: &mut AiOutput<'_>) -> AppResult<()> {
        let content = value
            .get("content")
            .and_then(Value::as_array)
            .ok_or_else(invalid)?;
        if content.len() > 256 {
            return Err(invalid());
        }
        for (i, value) in content.iter().enumerate() {
            self.content(value, i as u32, output)?;
        }
        usage::read(AiProtocol::AnthropicMessages, value.get("usage"), output)?;
        self.finish(value.get("stop_reason"), output)
    }

    pub(super) fn event(
        &mut self,
        kind: &str,
        value: &Value,
        output: &mut AiOutput<'_>,
    ) -> AppResult<EventStatus> {
        match kind {
            "ping" => output.heartbeat(),
            "error" => return Err(AiProviderErrorCode::Failed.error()),
            "message_start" => {
                if self.started {
                    return Err(invalid());
                }
                let message = value.get("message").ok_or_else(invalid)?;
                if !message
                    .get("content")
                    .and_then(Value::as_array)
                    .is_some_and(Vec::is_empty)
                {
                    return Err(invalid());
                }
                usage::read(AiProtocol::AnthropicMessages, message.get("usage"), output)?;
                self.started = true;
            }
            "content_block_start" => {
                if !self.started || self.stopped || self.active.is_some() {
                    return Err(invalid());
                }
                let index = index(value, "index")?;
                if index != self.next_index || index >= 256 {
                    return Err(invalid());
                }
                let kind = self.content(
                    value.get("content_block").ok_or_else(invalid)?,
                    index,
                    output,
                )?;
                self.active = Some((index, kind));
            }
            "content_block_delta" => {
                let index = index(value, "index")?;
                let (active_index, active_kind) = self.active.ok_or_else(invalid)?;
                if index != active_index || self.stopped {
                    return Err(invalid());
                }
                let delta = value.get("delta").ok_or_else(invalid)?;
                match (active_kind, delta.get("type").and_then(Value::as_str)) {
                    (Kind::Text, Some("text_delta")) => {
                        output.text_delta(block(index), text(delta, "text")?)?
                    }
                    (Kind::Thinking, Some("thinking_delta")) => output.reasoning(
                        block(index),
                        AiReasoningKind::VisibleThinking,
                        text(delta, "thinking")?,
                        false,
                    ),
                    // Signatures authenticate provider content; they are never visible text.
                    (Kind::Thinking, Some("signature_delta")) => {
                        text(delta, "signature")?;
                    }
                    _ => return Err(invalid()),
                }
            }
            "content_block_stop" => {
                if self.active.map(|(index, _)| index) != Some(index(value, "index")?) {
                    return Err(invalid());
                }
                self.active = None;
                self.next_index += 1;
            }
            "message_delta" => {
                if !self.started || self.stopped || self.active.is_some() {
                    return Err(invalid());
                }
                self.finish(value.pointer("/delta/stop_reason"), output)?;
                usage::read(AiProtocol::AnthropicMessages, value.get("usage"), output)?;
                self.stopped = true;
            }
            "message_stop" => {
                if !self.stopped || self.active.is_some() {
                    return Err(AiProviderErrorCode::Incomplete.error());
                }
                return Ok(EventStatus::Completed);
            }
            _ => return Ok(EventStatus::Ignored),
        }
        Ok(EventStatus::Accepted)
    }
}
