#[cfg(desktop)]
use rmcp::schemars;
use serde::{Deserialize, Serialize};
use specta::Type;

/// Optional todo priority; absence means none was chosen.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[cfg_attr(desktop, derive(rmcp::schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub enum TodoPriority {
    High,
    Medium,
    Low,
}

impl TodoPriority {
    /// Stable storage token; the database column is plain TEXT.
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            TodoPriority::High => "high",
            TodoPriority::Medium => "medium",
            TodoPriority::Low => "low",
        }
    }

    /// Unknown or empty storage values read back as "no priority" rather than failing the row.
    pub(crate) fn from_db(value: Option<String>) -> Option<Self> {
        match value.as_deref() {
            Some("high") => Some(TodoPriority::High),
            Some("medium") => Some(TodoPriority::Medium),
            Some("low") => Some(TodoPriority::Low),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[cfg_attr(desktop, derive(rmcp::schemars::JsonSchema))]
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
    #[serde(default)]
    pub priority: Option<TodoPriority>,
    // Abandoned items are mutually exclusive with completed ones.
    #[serde(default)]
    pub abandoned: bool,
    #[serde(default)]
    pub abandoned_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Payload for creating/updating a todo item (id/timestamps managed by backend).
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[cfg_attr(desktop, derive(rmcp::schemars::JsonSchema))]
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
    // Abandoned state is managed by its own command, not the editor payload.
    #[serde(default)]
    pub priority: Option<TodoPriority>,
}
