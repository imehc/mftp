use serde::{Deserialize, Serialize};
use specta::Type;

use crate::error::AppError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum SessionAgent {
    Claude,
    Codex,
    Workbuddy,
    Opencode,
    Copilot,
    Qoder,
    Codebuddy,
}

#[cfg(target_os = "macos")]
impl SessionAgent {
    pub(super) fn slug(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
            Self::Workbuddy => "workbuddy",
            Self::Opencode => "opencode",
            Self::Copilot => "copilot",
            Self::Qoder => "qoder",
            Self::Codebuddy => "codebuddy",
        }
    }
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum SessionContentAvailability {
    #[default]
    Full,
    Encrypted,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionSource {
    pub agent: SessionAgent,
    pub root: String,
    pub available: bool,
    pub count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionIssue {
    pub agent: SessionAgent,
    pub path: String,
    pub error: AppError,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionsSnapshot {
    pub generation: String,
    pub scanned_at: f64,
    pub sources: Vec<SessionSource>,
    pub total: u32,
    pub issues: Vec<SessionIssue>,
    pub complete: bool,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionStorage {
    pub generation: String,
    pub sources: Vec<AgentSessionStorageSource>,
    pub items: Vec<AgentSessionStorageItem>,
    pub complete: bool,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionStorageSource {
    pub agent: SessionAgent,
    pub bytes: f64,
    pub allocated_bytes: f64,
    pub complete: bool,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionStorageItem {
    pub key: String,
    pub bytes: Option<f64>,
    pub allocated_bytes: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionSummary {
    pub key: String,
    pub agent: SessionAgent,
    pub session_id: Option<String>,
    pub title: String,
    pub preview: String,
    pub cwd: String,
    pub path: String,
    pub updated_at: f64,
    pub created_at: Option<f64>,
    pub message_count: u32,
    pub revision: String,
    pub match_index: Option<u32>,
    pub model: Option<String>,
    pub archived: bool,
    pub content_availability: SessionContentAvailability,
}

#[derive(Debug, Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionQuery {
    pub generation: String,
    pub agent: Option<SessionAgent>,
    pub archived: Option<bool>,
    pub search: String,
    pub from: Option<f64>,
    pub to: Option<f64>,
    #[serde(default)]
    pub sort: SessionSort,
    pub min_bytes: Option<f64>,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum SessionSort {
    #[default]
    Updated,
    Size,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionPage {
    pub generation: String,
    pub items: Vec<AgentSessionSummary>,
    pub total: u32,
    pub next_offset: Option<u32>,
    pub complete: bool,
    pub issues: Vec<SessionIssue>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum SessionRole {
    User,
    Assistant,
    Tool,
    Thinking,
    System,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionMessage {
    pub index: u32,
    pub role: SessionRole,
    pub text: String,
    pub timestamp: Option<f64>,
    pub truncated: bool,
    pub model: Option<String>,
    pub images: Vec<AgentSessionImageRef>,
    pub continuation: bool,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionImageRef {
    pub index: u32,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionImagePayload {
    pub data_base64: String,
    pub mime: String,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionDetail {
    pub session: AgentSessionSummary,
    pub messages: Vec<AgentSessionMessage>,
    pub total: u32,
    pub next_offset: Option<u32>,
    pub complete: bool,
}
