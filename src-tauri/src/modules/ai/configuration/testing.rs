use serde::{Deserialize, Serialize};
use specta::Type;

use crate::error::AppError;
use crate::modules::ai::{
    completion::{AiCompletionDiagnostics, AiUsage},
    AiProtocol,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum AiProviderTestMode {
    NonStreaming,
    Streaming,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum AiProviderTestStatus {
    NotTested,
    Passed,
    Unverified,
    Failed,
}

/// Evidence from this request only; false means unobserved, never unsupported.
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AiTestReasoningEvidence {
    pub phase_observed: bool,
    pub activity_observed: bool,
    pub public_content_observed: bool,
    pub reasoning_tokens: Option<u32>,
}

/// Only saved public configuration and bounded runtime diagnostics cross IPC.
/// Neither generated text nor provider-supplied error bodies belong in a report.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderTestReport {
    pub mode: AiProviderTestMode,
    pub protocol: AiProtocol,
    pub endpoint: String,
    pub model: String,
    pub service_reachable: bool,
    pub non_streaming: AiProviderTestStatus,
    pub streaming: AiProviderTestStatus,
    pub reasoning: AiTestReasoningEvidence,
    pub usage: AiUsage,
    pub elapsed_ms: u32,
    pub diagnostics: Option<AiCompletionDiagnostics>,
    pub error: Option<AppError>,
}
