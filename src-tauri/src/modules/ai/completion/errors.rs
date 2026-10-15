use serde::{Deserialize, Serialize};
use specta::Type;

use super::{AiFinishReason, AiTimeoutStage};
use crate::error::AppError;

/// Stable external error codes shared by all AI protocols.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum AiProviderErrorCode {
    #[serde(rename = "ai:request_policy_invalid")]
    RequestPolicy,
    #[serde(rename = "ai:cancelled")]
    Cancelled,
    #[serde(rename = "ai:output_invalid")]
    OutputInvalid,
    #[serde(rename = "ai:provider_timeout")]
    Timeout,
    #[serde(rename = "ai:provider_connection_timeout")]
    ConnectionTimeout,
    #[serde(rename = "ai:provider_first_event_timeout")]
    FirstEventTimeout,
    #[serde(rename = "ai:provider_stream_idle")]
    StreamIdle,
    #[serde(rename = "ai:provider_progress_timeout")]
    ProgressTimeout,
    #[serde(rename = "ai:provider_incomplete")]
    Incomplete,
    #[serde(rename = "ai:provider_no_text")]
    NoText,
    #[serde(rename = "ai:provider_limit_reached")]
    LimitReached,
    #[serde(rename = "ai:provider_protocol")]
    Protocol,
    #[serde(rename = "ai:provider_status")]
    Status,
    #[serde(rename = "ai:provider_failed")]
    Failed,
}

impl AiProviderErrorCode {
    pub(crate) fn timeout(stage: AiTimeoutStage) -> AppError {
        let (code, name) = match stage {
            AiTimeoutStage::Connection => (Self::ConnectionTimeout, "connection"),
            AiTimeoutStage::FirstEvent => (Self::FirstEventTimeout, "firstEvent"),
            AiTimeoutStage::TransportIdle => (Self::StreamIdle, "transportIdle"),
            AiTimeoutStage::ReasoningProgress => (Self::ProgressTimeout, "reasoningProgress"),
            AiTimeoutStage::TextProgress => (Self::ProgressTimeout, "textProgress"),
            AiTimeoutStage::UnobservedProgress => (Self::ProgressTimeout, "unobservedProgress"),
            AiTimeoutStage::HardDeadline => (Self::Timeout, "hardDeadline"),
        };
        code.error().with_arg("timeoutStage", name)
    }

    pub(crate) fn with_finish_reason(self, reason: Option<&str>) -> AppError {
        self.error().with_arg(
            "finishReason",
            AiFinishReason::from_provider(reason).as_str(),
        )
    }

    pub(crate) fn error(self) -> AppError {
        let (code, message) = match self {
            Self::RequestPolicy => (
                "ai:request_policy_invalid",
                "AI request policy is invalid for the selected protocol",
            ),
            Self::Cancelled => ("ai:cancelled", "AI request was cancelled"),
            Self::OutputInvalid => (
                "ai:output_invalid",
                "AI output does not match the requested format",
            ),
            Self::Timeout => (
                "ai:provider_timeout",
                "AI provider request deadline was reached",
            ),
            Self::ConnectionTimeout => (
                "ai:provider_connection_timeout",
                "AI provider connection timed out",
            ),
            Self::FirstEventTimeout => (
                "ai:provider_first_event_timeout",
                "AI provider did not send the first protocol event in time",
            ),
            Self::StreamIdle => ("ai:provider_stream_idle", "AI provider stream became idle"),
            Self::ProgressTimeout => (
                "ai:provider_progress_timeout",
                "AI provider made no progress within the allowed interval",
            ),
            Self::Incomplete => (
                "ai:provider_incomplete",
                "AI provider returned an incomplete response",
            ),
            Self::NoText => (
                "ai:provider_no_text",
                "AI provider completed without output text",
            ),
            Self::LimitReached => (
                "ai:provider_limit_reached",
                "AI provider reached the output or reasoning budget",
            ),
            Self::Protocol => (
                "ai:provider_protocol",
                "AI provider returned invalid protocol data",
            ),
            Self::Status => (
                "ai:provider_status",
                "AI provider returned an unsuccessful HTTP status",
            ),
            Self::Failed => (
                "ai:provider_failed",
                "AI provider failed to complete the request",
            ),
        };
        AppError::external(code, message)
    }
}
