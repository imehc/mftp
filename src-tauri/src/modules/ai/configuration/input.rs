use serde::{Deserialize, Deserializer};
use specta::Type;

// Secret-bearing inputs deliberately omit Debug and Serialize. Deserialization
// failures also discard serde's value-bearing diagnostic before crossing IPC.
fn secret<'de, D: Deserializer<'de>>(d: D) -> Result<String, D::Error> {
    String::deserialize(d).map_err(|_| serde::de::Error::custom("Invalid credential input"))
}
fn optional_secret<'de, D: Deserializer<'de>>(d: D) -> Result<Option<String>, D::Error> {
    Option::<String>::deserialize(d)
        .map_err(|_| serde::de::Error::custom("Invalid credential input"))
}

#[derive(Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderCreateInput {
    pub expected_revision: i64,
    pub name: String,
    pub base_url: String,
    pub key_label: String,
    #[serde(deserialize_with = "secret")]
    #[specta(type = String)]
    pub api_key: String,
    pub model_id: String,
    pub display_name: Option<String>,
}

#[derive(Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderUpdateInput {
    pub expected_revision: i64,
    pub provider_id: String,
    pub name: String,
    pub base_url: String,
}

#[derive(Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderDeleteInput {
    pub expected_revision: i64,
    pub provider_id: String,
}

#[derive(Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AiKeySaveInput {
    pub expected_revision: i64,
    pub provider_id: String,
    pub key_id: Option<String>,
    pub label: String,
    #[serde(default, deserialize_with = "optional_secret")]
    #[specta(type = Option<String>)]
    pub replacement_secret: Option<String>,
}

#[derive(Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AiKeyDeleteInput {
    pub expected_revision: i64,
    pub provider_id: String,
    pub key_id: String,
    pub replacement_key_id: Option<String>,
}

#[derive(Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AiModelSaveInput {
    pub expected_revision: i64,
    pub provider_id: String,
    /// Row identity differs from the remote API model identifier.
    pub id: Option<String>,
    pub model_id: String,
    pub display_name: Option<String>,
}

#[derive(Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AiModelDeleteInput {
    pub expected_revision: i64,
    pub provider_id: String,
    pub id: String,
    pub replacement_model_id: Option<String>,
}

#[derive(Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderTargetInput {
    pub expected_revision: i64,
    pub provider_id: String,
}

#[derive(Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderSelectionInput {
    pub expected_revision: i64,
    pub provider_id: String,
    pub current_key_id: String,
    pub current_model_id: String,
}

#[derive(Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AiModelSwitchInput {
    pub expected_revision: i64,
    pub expected_active_provider_id: String,
    /// Local model row identity, not the remote API model name.
    pub model_id: String,
}

#[derive(Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AiStreamingUpdateInput {
    pub expected_revision: i64,
    pub streaming_enabled: bool,
}
