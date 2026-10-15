use serde::{Deserialize, Serialize};

use super::{AiOutputPolicy, AiProviderErrorCode, AiReasoningEffort};
use crate::error::AppResult;
use crate::modules::ai::AiProtocol;

/// Domain-owned prompt and limits. Debug deliberately excludes source content.
#[derive(Clone, PartialEq, Eq)]
pub struct AiTextRequest {
    pub instructions: String,
    pub input: String,
    pub max_output_tokens: u32,
    pub output_limit_bytes: usize,
}

impl std::fmt::Debug for AiTextRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AiTextRequest")
            .field("max_output_tokens", &self.max_output_tokens)
            .field("output_limit_bytes", &self.output_limit_bytes)
            .finish_non_exhaustive()
    }
}

/// Selecting a variant is an explicit assertion of verified provider capability.
/// ProviderDefault sends no reasoning parameters and never guesses from a model name.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AiReasoningPolicy {
    #[default]
    ProviderDefault,
    Responses {
        effort: Option<AiReasoningEffort>,
        summary: bool,
    },
    ChatCompletions {
        effort: Option<AiReasoningEffort>,
        reasoning_content: bool,
    },
    Anthropic {
        budget_tokens: u32,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AiTimeoutPolicy {
    pub connection_ms: u32,
    pub response_headers_ms: u32,
    pub first_event_ms: u32,
    pub transport_idle_ms: u32,
    pub reasoning_progress_ms: u32,
    pub text_progress_ms: u32,
    pub unobserved_progress_ms: u32,
    pub soft_wait_ms: u32,
    pub hard_deadline_ms: u32,
    pub max_deadline_ms: u32,
}

impl Default for AiTimeoutPolicy {
    fn default() -> Self {
        Self {
            connection_ms: 30_000,
            response_headers_ms: 180_000,
            first_event_ms: 180_000,
            transport_idle_ms: 180_000,
            reasoning_progress_ms: 180_000,
            text_progress_ms: 90_000,
            unobserved_progress_ms: 180_000,
            soft_wait_ms: 45_000,
            hard_deadline_ms: 300_000,
            max_deadline_ms: 900_000,
        }
    }
}

pub struct AiCompletionRequest<'a> {
    pub text: &'a AiTextRequest,
    pub streaming: bool,
    pub output_policy: AiOutputPolicy,
    pub reasoning: AiReasoningPolicy,
    pub show_reasoning: bool,
    pub reasoning_limit_bytes: usize,
    pub timeout: AiTimeoutPolicy,
}

impl<'a> AiCompletionRequest<'a> {
    pub fn text(text: &'a AiTextRequest, streaming: bool) -> Self {
        Self {
            text,
            streaming,
            output_policy: AiOutputPolicy::Text,
            reasoning: AiReasoningPolicy::ProviderDefault,
            show_reasoning: false,
            reasoning_limit_bytes: 64 * 1024,
            timeout: AiTimeoutPolicy::default(),
        }
    }

    pub(crate) fn validate(&self, protocol: AiProtocol) -> AppResult<()> {
        let t = self.timeout;
        let valid_reasoning = match self.reasoning {
            AiReasoningPolicy::ProviderDefault => true,
            AiReasoningPolicy::Responses { .. } => protocol == AiProtocol::Responses,
            AiReasoningPolicy::ChatCompletions { .. } => protocol == AiProtocol::ChatCompletions,
            AiReasoningPolicy::Anthropic { budget_tokens } => {
                protocol == AiProtocol::AnthropicMessages
                    && budget_tokens >= 1024
                    && budget_tokens < self.text.max_output_tokens
            }
        };
        if !valid_reasoning
            || self.text.max_output_tokens == 0
            || self.text.output_limit_bytes == 0
            || self.text.output_limit_bytes > 1024 * 1024
            || self.reasoning_limit_bytes > 1024 * 1024
            || [
                t.connection_ms,
                t.response_headers_ms,
                t.first_event_ms,
                t.transport_idle_ms,
                t.reasoning_progress_ms,
                t.text_progress_ms,
                t.unobserved_progress_ms,
                t.soft_wait_ms,
                t.hard_deadline_ms,
                t.max_deadline_ms,
            ]
            .iter()
            .any(|value| *value == 0 || *value > 3_600_000)
            || t.soft_wait_ms > t.hard_deadline_ms
            || t.hard_deadline_ms > t.max_deadline_ms
        {
            return Err(AiProviderErrorCode::RequestPolicy.error());
        }
        Ok(())
    }
}

/// The domain owns this bounded channel for exactly one request. Closing it cancels.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum AiControlMessage {
    Cancel,
    Extend { additional_ms: u32 },
}
