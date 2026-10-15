use super::{invalid, usage, EventStatus};
use crate::error::AppResult;
use crate::modules::ai::{
    completion::{
        AiContentBlock, AiOutput, AiProviderErrorCode, AiReasoningKind, AiReasoningPolicy,
    },
    AiProtocol,
};
use serde_json::Value;

pub(super) struct Chat {
    stopped: bool,
    reasoning_content: bool,
}
const BLOCK: AiContentBlock = AiContentBlock {
    output_index: 0,
    content_index: 0,
};

impl Chat {
    pub(super) fn new(reasoning: AiReasoningPolicy) -> Self {
        Self {
            stopped: false,
            reasoning_content: matches!(
                reasoning,
                AiReasoningPolicy::ChatCompletions {
                    reasoning_content: true,
                    ..
                }
            ),
        }
    }

    fn content(&self, value: &Value, output: &mut AiOutput<'_>, streaming: bool) -> AppResult<()> {
        if !value.is_object() {
            return Err(invalid());
        }
        if value
            .get("tool_calls")
            .or_else(|| value.get("function_call"))
            .is_some_and(|v| !v.is_null())
        {
            return Err(AiProviderErrorCode::Failed.with_finish_reason(Some("tool_calls")));
        }
        if self.reasoning_content {
            if let Some(reasoning) = value.get("reasoning_content").filter(|v| !v.is_null()) {
                output.reasoning(
                    BLOCK,
                    AiReasoningKind::VisibleThinking,
                    reasoning.as_str().ok_or_else(invalid)?,
                    false,
                );
            }
        }
        if let Some(content) = value.get("content").filter(|v| !v.is_null()) {
            let content = content.as_str().ok_or_else(invalid)?;
            if streaming {
                output.text_delta(BLOCK, content)?;
            } else {
                output.text(BLOCK, content)?;
            }
        }
        Ok(())
    }

    pub(super) fn plain(&self, value: &Value, output: &mut AiOutput<'_>) -> AppResult<()> {
        let choices = value
            .get("choices")
            .and_then(Value::as_array)
            .ok_or_else(invalid)?;
        if choices.len() != 1 {
            return Err(invalid());
        }
        let choice = &choices[0];
        self.content(choice.get("message").ok_or_else(invalid)?, output, false)?;
        usage::read(AiProtocol::ChatCompletions, value.get("usage"), output)?;
        self.finish(choice.get("finish_reason"), output)
    }

    fn finish(&self, reason: Option<&Value>, output: &AiOutput<'_>) -> AppResult<()> {
        let reason = reason.and_then(Value::as_str);
        if matches!(
            reason,
            Some("stop" | "length" | "content_filter" | "tool_calls" | "function_call")
        ) {
            output.finish(reason)
        } else {
            Err(AiProviderErrorCode::Incomplete.with_finish_reason(reason))
        }
    }

    pub(super) fn event(
        &mut self,
        value: &Value,
        output: &mut AiOutput<'_>,
    ) -> AppResult<EventStatus> {
        if value.get("error").is_some() {
            return Err(AiProviderErrorCode::Failed.error());
        }
        let choices = value
            .get("choices")
            .and_then(Value::as_array)
            .ok_or_else(invalid)?;
        if choices.is_empty() && !value.get("usage").is_some_and(Value::is_object) {
            return Err(invalid());
        }
        for choice in choices {
            if choice.get("index").and_then(Value::as_u64) != Some(0) || self.stopped {
                return Err(invalid());
            }
            self.content(choice.get("delta").ok_or_else(invalid)?, output, true)?;
            if let Some(reason) = choice.get("finish_reason").filter(|value| !value.is_null()) {
                self.finish(Some(reason), output)?;
                self.stopped = true;
            }
        }
        usage::read(AiProtocol::ChatCompletions, value.get("usage"), output)?;
        Ok(EventStatus::Accepted)
    }

    pub(super) fn done(&self) -> AppResult<EventStatus> {
        if self.stopped {
            Ok(EventStatus::Completed)
        } else {
            Err(AiProviderErrorCode::Incomplete.error())
        }
    }
}
