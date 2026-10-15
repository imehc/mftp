//! Shared completion contracts. Only sanitized metadata may enter diagnostics;
//! text events are reserved for a task owner's channel, never an app broadcast.

mod diagnostics;
mod emitter;
mod errors;
mod events;
mod model;
mod output;
mod request;

pub(crate) use diagnostics::AiObservation;
pub(crate) use emitter::AiEmitter;
pub use errors::AiProviderErrorCode;
pub use events::{AiContentBlock, AiReasoningKind, AiStreamEvent, AiStreamEventPayload};
pub use model::{
    AiCompletionDiagnostics, AiFinishReason, AiObservedPhase, AiOutputPolicy, AiReasoningEffort,
    AiRunOutcome, AiTimeoutStage, AiUsage,
};
pub(crate) use output::{AiCompletionResult, AiOutput};
pub use request::{
    AiCompletionRequest, AiControlMessage, AiReasoningPolicy, AiTextRequest, AiTimeoutPolicy,
};

#[cfg(test)]
mod tests;
