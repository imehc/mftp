use serde::{Deserialize, Serialize};
use specta::Type;

use crate::modules::ai::AiProtocol;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AiReasoningEffort {
    Low,
    Medium,
    High,
}

/// The runtime requires bounded, nonempty text and validates JSON syntax (an object
/// for GameMove). After protocol completion, callers must enforce their domain
/// schema and, for game moves, the current match, position, seat, and legal moves.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum AiOutputPolicy {
    Text,
    StructuredJson,
    GameMove,
}

/// An observed phase is evidence, not an inference from latency or a model name.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum AiObservedPhase {
    #[default]
    Connecting,
    Waiting,
    Reasoning,
    Text,
}

impl AiObservedPhase {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::Connecting => "connecting",
            Self::Waiting => "waiting",
            Self::Reasoning => "reasoning",
            Self::Text => "text",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum AiTimeoutStage {
    Connection,
    FirstEvent,
    TransportIdle,
    ReasoningProgress,
    TextProgress,
    UnobservedProgress,
    HardDeadline,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum AiRunOutcome {
    Completed,
    TimedOut,
    Cancelled,
    Incomplete,
    NoText,
    LimitReached,
    ProviderFailed,
    ProtocolInvalid,
}

/// Normalized allowlist: never copy an arbitrary provider finish reason into IPC.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum AiFinishReason {
    Stop,
    Length,
    ContentFilter,
    ToolCall,
    Incomplete,
    Failed,
    Unknown,
}

impl AiFinishReason {
    pub(crate) fn from_provider(value: Option<&str>) -> Self {
        match value {
            Some("completed" | "stop" | "end_turn" | "stop_sequence") => Self::Stop,
            Some("length" | "max_tokens" | "max_output_tokens") => Self::Length,
            Some("content_filter" | "refusal") => Self::ContentFilter,
            Some("tool_calls" | "function_call" | "tool_use") => Self::ToolCall,
            Some("incomplete") => Self::Incomplete,
            Some("failed") => Self::Failed,
            _ => Self::Unknown,
        }
    }

    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::Stop => "stop",
            Self::Length => "length",
            Self::ContentFilter => "contentFilter",
            Self::ToolCall => "toolCall",
            Self::Incomplete => "incomplete",
            Self::Failed => "failed",
            Self::Unknown => "unknown",
        }
    }
}

/// Missing usage is unknown, not zero. Reasoning tokens may be part of output tokens.
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AiUsage {
    pub input_tokens: Option<u32>,
    pub output_tokens: Option<u32>,
    pub reasoning_tokens: Option<u32>,
}

/// Relative monotonic milliseconds, bounded counters and local enums only.
/// No prompts, output, URLs, credentials, provider IDs or opaque reasoning data.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AiCompletionDiagnostics {
    pub protocol: AiProtocol,
    pub phase: AiObservedPhase,
    pub elapsed_ms: u32,
    pub received_bytes: u32,
    pub received_text_bytes: u32,
    pub stream_text_delta_count: u32,
    pub received_reasoning_bytes: u32,
    pub had_reasoning_activity: bool,
    pub last_transport_activity_ms: Option<u32>,
    pub last_reasoning_progress_ms: Option<u32>,
    pub last_text_progress_ms: Option<u32>,
    pub finish_reason: Option<AiFinishReason>,
    pub response_started_ms: Option<u32>,
    pub first_event_ms: Option<u32>,
    pub phase_started_ms: u32,
    pub hard_deadline_ms: u32,
}
