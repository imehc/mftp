use serde::{Deserialize, Serialize};
use specta::Type;

use super::{AiCompletionDiagnostics, AiFinishReason, AiObservedPhase, AiUsage};
use crate::error::AppError;

/// Adapter-normalized indices; raw provider IDs and signatures stay in the backend.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AiContentBlock {
    pub output_index: u32,
    pub content_index: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum AiReasoningKind {
    Summary,
    VisibleThinking,
}

/// This payload contains private task text. Do not persist or broadcast it.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AiStreamEventPayload {
    Started,
    PhaseChanged {
        phase: AiObservedPhase,
        block: Option<AiContentBlock>,
    },
    ReasoningDelta {
        block: AiContentBlock,
        kind: AiReasoningKind,
        text: String,
    },
    Heartbeat,
    SoftWait {
        hard_deadline_ms: u32,
    },
    DeadlineExtended {
        hard_deadline_ms: u32,
    },
    ReasoningTruncated,
    TextDelta {
        block: AiContentBlock,
        text: String,
    },
    Usage {
        usage: AiUsage,
    },
    Completed {
        finish_reason: AiFinishReason,
        diagnostics: AiCompletionDiagnostics,
    },
    Incomplete {
        error: AppError,
        reason: AiFinishReason,
        diagnostics: AiCompletionDiagnostics,
    },
    Failed {
        error: AppError,
        diagnostics: AiCompletionDiagnostics,
    },
    Cancelled {
        diagnostics: AiCompletionDiagnostics,
    },
}

/// The runtime assigns a local UUID and increasing sequence for each request.
/// A retry gets a new UUID; consumers reject events from superseded requests.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AiStreamEvent {
    pub request_id: String,
    pub sequence: u32,
    pub elapsed_ms: u32,
    pub payload: AiStreamEventPayload,
}

impl std::fmt::Debug for AiStreamEvent {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Even accidental debug logging must not reveal task text or identifiers.
        f.debug_struct("AiStreamEvent")
            .field("sequence", &self.sequence)
            .field("elapsed_ms", &self.elapsed_ms)
            .finish_non_exhaustive()
    }
}
