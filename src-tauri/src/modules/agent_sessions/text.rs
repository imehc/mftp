use serde_json::Value;

use crate::core::diagnostics::Redactor;

pub(super) fn clip(text: &str, limit: usize) -> String {
    text.chars().take(limit).collect()
}

pub(super) fn safe_preview(text: &str) -> String {
    // Historical text has unknown provenance. Keep previews short and apply
    // the shared credential/URL redactor before returning any projection.
    let safe = Redactor::default().text(text).0;
    clip(&safe.split_whitespace().collect::<Vec<_>>().join(" "), 200)
}

pub(super) fn timestamp(value: &Value) -> Option<f64> {
    if let Some(number) = value.as_f64().filter(|n| n.is_finite()) {
        return Some(if number < 1e11 {
            number * 1000.0
        } else if number > 1e14 {
            number / 1000.0
        } else {
            number
        });
    }
    value.as_str().and_then(|value| {
        chrono::DateTime::parse_from_rfc3339(value)
            .ok()
            .map(|time| time.timestamp_millis() as f64)
    })
}

pub(super) fn content(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Array(blocks) => blocks
            .iter()
            .filter_map(|block| {
                ["text", "input_text", "output_text"]
                    .into_iter()
                    .find_map(|key| block.get(key).and_then(Value::as_str))
            })
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

pub(super) fn is_notice(text: &str) -> bool {
    let text = text.trim_start();
    [
        "<task-notification",
        "<cb_summary",
        "<conversation_history_summary",
        "<buddy-notification",
        "<automation-notification",
        "[SYSTEM NOTIFICATION",
    ]
    .iter()
    .any(|prefix| text.starts_with(prefix))
        || (text.starts_with("<system-reminder") && !text.contains("<user_query>"))
}

pub(super) fn clean_user(text: &str) -> String {
    if is_notice(text) {
        return String::new();
    }
    if let Some((_, query)) = text.split_once("<user_query>") {
        if let Some((query, _)) = query.split_once("</user_query>") {
            return query.trim().into();
        }
    }
    let mut text = text.to_owned();
    while let Some(start) = text.find("<system-reminder") {
        let Some(end) = text[start..].find("</system-reminder>") else {
            break;
        };
        text.replace_range(start..start + end + "</system-reminder>".len(), "");
    }
    let text = text.trim();
    if [
        "# AGENTS.md instructions",
        "<environment_context",
        "<user_instructions",
        "<skills_instructions",
        "<multi_agent_role",
        "<permissions",
        "<codex_internal_context",
        "<INSTRUCTIONS>",
        "## Skills",
        "You are Codex",
        "# Code Mode",
    ]
    .iter()
    .any(|prefix| text.starts_with(prefix))
    {
        return String::new();
    }
    text.into()
}

pub(super) fn excerpt(text: &str, needle: &str) -> String {
    let chars: Vec<_> = text.chars().collect();
    // Case folding can change UTF-8 lengths; locate by character indices
    // instead of applying folded byte offsets to the original string.
    let mut folded = String::new();
    let mut offsets = Vec::new();
    for (index, character) in chars.iter().enumerate() {
        let lower = character.to_lowercase().collect::<String>();
        offsets.extend(std::iter::repeat_n(index, lower.len()));
        folded.push_str(&lower);
    }
    let position = folded
        .find(needle)
        .and_then(|index| offsets.get(index))
        .copied()
        .unwrap_or(0);
    let start = position.saturating_sub(45);
    let body: String = chars.iter().skip(start).take(200).collect();
    safe_preview(&format!("{}{}", if start > 0 { "…" } else { "" }, body))
}
