use super::invalid;
use crate::error::AppResult;
use crate::modules::ai::{
    completion::{AiOutput, AiUsage},
    AiProtocol,
};
use serde_json::Value;

pub(super) fn read(
    protocol: AiProtocol,
    value: Option<&Value>,
    output: &mut AiOutput<'_>,
) -> AppResult<()> {
    let Some(value) = value.filter(|value| !value.is_null()) else {
        return Ok(());
    };
    if !value.is_object() {
        return Err(invalid());
    }
    let (input, out, reasoning) = match protocol {
        AiProtocol::Responses => (
            "input_tokens",
            "output_tokens",
            "/output_tokens_details/reasoning_tokens",
        ),
        AiProtocol::ChatCompletions => (
            "prompt_tokens",
            "completion_tokens",
            "/completion_tokens_details/reasoning_tokens",
        ),
        AiProtocol::AnthropicMessages => ("input_tokens", "output_tokens", "/reasoning_tokens"),
    };
    output.usage(AiUsage {
        input_tokens: count(value.get(input))?,
        output_tokens: count(value.get(out))?,
        reasoning_tokens: count(value.pointer(reasoning))?,
    });
    Ok(())
}

fn count(value: Option<&Value>) -> AppResult<Option<u32>> {
    value
        .filter(|value| !value.is_null())
        .map(|value| {
            value
                .as_u64()
                .and_then(|n| u32::try_from(n).ok())
                .ok_or_else(invalid)
        })
        .transpose()
}
