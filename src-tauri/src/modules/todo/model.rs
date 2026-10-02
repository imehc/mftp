use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TodoItem {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub due_date: Option<String>,
    // Absolute scheduled instant; date-only legacy records keep this absent.
    #[serde(default)]
    pub due_at: Option<i64>,
    pub completed: bool,
    // Unknown historical completion times are never inferred from updated_at.
    #[serde(default)]
    pub completed_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Payload for creating/updating a todo item (id/timestamps managed by backend).
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TodoItemInput {
    pub title: String,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub due_date: Option<String>,
    // UI converts local date/time to UTC milliseconds before invoking commands.
    #[serde(default)]
    pub due_at: Option<i64>,
    pub completed: bool,
}
