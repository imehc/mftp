use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum AiProtocol {
    #[default]
    Responses,
    ChatCompletions,
    AnthropicMessages,
}

impl AiProtocol {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Responses => "responses",
            Self::ChatCompletions => "chatCompletions",
            Self::AnthropicMessages => "anthropicMessages",
        }
    }
}

impl rusqlite::types::FromSql for AiProtocol {
    fn column_result(value: rusqlite::types::ValueRef<'_>) -> rusqlite::types::FromSqlResult<Self> {
        match value.as_str()? {
            "responses" => Ok(Self::Responses),
            "chatCompletions" => Ok(Self::ChatCompletions),
            "anthropicMessages" => Ok(Self::AnthropicMessages),
            _ => Err(rusqlite::types::FromSqlError::InvalidType),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AiConnectionConfig {
    pub protocol: AiProtocol,
    pub base_url: String,
    pub model: String,
    pub streaming_enabled: bool,
}
