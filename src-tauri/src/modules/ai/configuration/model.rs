use serde::Serialize;
use specta::Type;

// These projections never contain credential references or credential values.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AiConfigurationView {
    pub revision: i64,
    pub active_provider_id: Option<String>,
    pub streaming_enabled: bool,
    pub providers: Vec<AiProviderView>,
    pub label_candidates: Vec<String>,
    pub model_candidates: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderView {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub requires_address_repair: bool,
    pub current_key_id: Option<String>,
    pub current_model_id: Option<String>,
    pub revision: i64,
    pub keys: Vec<AiKeyView>,
    pub models: Vec<AiModelView>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AiKeyView {
    pub id: String,
    pub label: String,
    pub state: AiKeyState,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum AiKeyState {
    SavedUnverified,
    Missing,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AiModelView {
    pub id: String,
    pub model_id: String,
    pub display_name: Option<String>,
}
