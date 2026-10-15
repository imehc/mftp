use super::{index, invalid, text, usage, EventStatus};
use crate::error::AppResult;
use crate::modules::ai::{
    completion::{AiContentBlock, AiObservedPhase, AiOutput, AiProviderErrorCode, AiReasoningKind},
    AiProtocol,
};
use serde_json::Value;
use std::collections::BTreeSet;

#[derive(Default)]
pub(super) struct Responses {
    completed: bool,
}

impl Responses {
    fn item(
        &self,
        item: &Value,
        output_index: u32,
        output: &mut AiOutput<'_>,
    ) -> AppResult<BTreeSet<AiContentBlock>> {
        let mut blocks = BTreeSet::new();
        match item.get("type").and_then(Value::as_str) {
            Some("reasoning") => {
                // Encrypted reasoning and signatures are intentionally not inspected.
                if let Some(summary) = item.get("summary") {
                    let summary = summary.as_array().ok_or_else(invalid)?;
                    if summary.len() > 256 {
                        return Err(invalid());
                    }
                    for (i, part) in summary.iter().enumerate() {
                        if part.get("type").and_then(Value::as_str) != Some("summary_text") {
                            return Err(invalid());
                        }
                        output.reasoning(
                            AiContentBlock {
                                output_index,
                                content_index: i as u32,
                            },
                            AiReasoningKind::Summary,
                            text(part, "text")?,
                            true,
                        );
                    }
                }
            }
            Some("message") | None => {
                let content = item
                    .get("content")
                    .and_then(Value::as_array)
                    .ok_or_else(invalid)?;
                if content.len() > 256 {
                    return Err(invalid());
                }
                for (i, part) in content.iter().enumerate() {
                    match part.get("type").and_then(Value::as_str) {
                        Some("output_text") => {
                            let block = AiContentBlock {
                                output_index,
                                content_index: i as u32,
                            };
                            output.text_done(block, text(part, "text")?)?;
                            blocks.insert(block);
                        }
                        Some("refusal") => {
                            return Err(
                                AiProviderErrorCode::Failed.with_finish_reason(Some("refusal"))
                            )
                        }
                        _ => return Err(invalid()),
                    }
                }
            }
            _ => return Err(AiProviderErrorCode::Failed.with_finish_reason(Some("tool_calls"))),
        }
        Ok(blocks)
    }

    pub(super) fn plain(&mut self, value: &Value, output: &mut AiOutput<'_>) -> AppResult<()> {
        let status = value
            .get("status")
            .and_then(Value::as_str)
            .ok_or_else(invalid)?;
        let mut blocks = BTreeSet::new();
        if let Some(items) = value.get("output") {
            let items = items.as_array().ok_or_else(invalid)?;
            if items.len() > 256 {
                return Err(invalid());
            }
            for (i, item) in items.iter().enumerate() {
                blocks.extend(self.item(item, i as u32, output)?);
            }
        } else if status == "completed" {
            return Err(invalid());
        }
        usage::read(AiProtocol::Responses, value.get("usage"), output)?;
        if status == "completed" {
            if blocks != output.text_blocks() {
                return Err(invalid());
            }
            output.finish(Some("completed"))
        } else {
            let reason = value
                .pointer("/incomplete_details/reason")
                .and_then(Value::as_str)
                .unwrap_or(status);
            output.finish(Some(reason))
        }
    }

    pub(super) fn event(
        &mut self,
        kind: &str,
        value: &Value,
        output: &mut AiOutput<'_>,
    ) -> AppResult<EventStatus> {
        if self.completed {
            return Err(invalid());
        }
        match kind {
            "response.created" | "response.in_progress" => {
                if !value.get("response").is_some_and(Value::is_object) {
                    return Err(invalid());
                }
            }
            "response.output_item.added" => {
                let item = value.get("item").ok_or_else(invalid)?;
                let output_index = index(value, "output_index")?;
                if item.get("type").and_then(Value::as_str) == Some("reasoning") {
                    output.phase(
                        AiObservedPhase::Reasoning,
                        Some(AiContentBlock {
                            output_index,
                            content_index: 0,
                        }),
                    );
                } else if item.get("type").and_then(Value::as_str) != Some("message") {
                    return Err(invalid());
                }
            }
            "response.output_item.done" => {
                self.item(
                    value.get("item").ok_or_else(invalid)?,
                    index(value, "output_index")?,
                    output,
                )?;
            }
            "response.content_part.added" | "response.content_part.done" => {
                let part = value.get("part").ok_or_else(invalid)?;
                if part.get("type").and_then(Value::as_str) != Some("output_text") {
                    return Err(invalid());
                }
                let block = block(value, "content_index")?;
                if kind.ends_with(".done") {
                    output.text_done(block, text(part, "text")?)?;
                }
            }
            "response.output_text.delta" => {
                output.text_delta(block(value, "content_index")?, text(value, "delta")?)?
            }
            "response.output_text.done" => {
                output.text_done(block(value, "content_index")?, text(value, "text")?)?
            }
            "response.reasoning_summary_text.delta" | "response.reasoning_summary_text.done" => {
                let done = kind.ends_with(".done");
                output.reasoning(
                    block(value, "summary_index")?,
                    AiReasoningKind::Summary,
                    text(value, if done { "text" } else { "delta" })?,
                    done,
                );
            }
            "response.reasoning_summary_part.added" | "response.reasoning_summary_part.done" => {
                let part = value.get("part").ok_or_else(invalid)?;
                if part.get("type").and_then(Value::as_str) != Some("summary_text") {
                    return Err(invalid());
                }
                output.reasoning(
                    block(value, "summary_index")?,
                    AiReasoningKind::Summary,
                    text(part, "text")?,
                    kind.ends_with(".done"),
                );
            }
            "response.completed" => {
                let response = value.get("response").ok_or_else(invalid)?;
                if response.get("status").and_then(Value::as_str) != Some("completed") {
                    return Err(invalid());
                }
                self.plain(response, output)?;
                self.completed = true;
                return Ok(EventStatus::Completed);
            }
            "response.incomplete" => {
                let response = value.get("response").ok_or_else(invalid)?;
                if response.get("status").and_then(Value::as_str) != Some("incomplete") {
                    return Err(invalid());
                }
                self.plain(response, output)?;
                return Err(AiProviderErrorCode::Incomplete.error());
            }
            "response.failed" | "error" => return Err(AiProviderErrorCode::Failed.error()),
            _ => return Ok(EventStatus::Ignored),
        }
        Ok(EventStatus::Accepted)
    }
}

fn block(value: &Value, field: &str) -> AppResult<AiContentBlock> {
    let output_index = index(value, "output_index")?;
    let content_index = index(value, field)?;
    if output_index >= 256 || content_index >= 256 {
        return Err(invalid());
    }
    Ok(AiContentBlock {
        output_index,
        content_index,
    })
}
