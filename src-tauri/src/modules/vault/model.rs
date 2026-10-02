use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct VaultEntry {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Payload for creating/updating a vault entry (id/timestamps managed by backend).
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct VaultEntryInput {
    pub title: String,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
}
