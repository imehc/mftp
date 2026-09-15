use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AiConnectionConfig {
    pub base_url: String,
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AiConnection {
    pub base_url: String,
    pub model: String,
    pub has_key: bool,
}

#[derive(Debug, Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AiConnectionInput {
    pub base_url: String,
    pub model: String,
    /// None keeps the existing credential; Some replaces it.
    #[serde(default)]
    pub api_key: Option<String>,
}
