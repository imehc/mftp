use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SshKey {
    pub id: String,
    pub label: String,
    pub filename: String,
    pub has_passphrase: bool,
    pub created_at: i64,
}
