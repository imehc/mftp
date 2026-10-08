use crate::error::{AppError, AppResult, CustomErrorCode};
use serde_json::Value;

pub(super) fn parse_output_text(bytes: &[u8]) -> AppResult<String> {
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

pub(super) fn handle_stream_event<F>(
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

pub(super) fn append_stream_text<F>(
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
