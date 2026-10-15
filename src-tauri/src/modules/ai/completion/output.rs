use super::{
    AiCompletionDiagnostics, AiCompletionRequest, AiContentBlock, AiEmitter, AiFinishReason,
    AiObservation, AiObservedPhase, AiOutputPolicy, AiProviderErrorCode, AiReasoningKind,
    AiStreamEventPayload, AiUsage,
};
use crate::error::{AppError, AppResult, CustomErrorCode};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};

pub(crate) struct AiCompletionResult {
    pub text: String,
    pub usage: AiUsage,
    pub diagnostics: AiCompletionDiagnostics,
}

impl std::fmt::Debug for AiCompletionResult {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AiCompletionResult")
            .field("diagnostics", &self.diagnostics)
            .finish_non_exhaustive()
    }
}

pub(crate) struct AiOutput<'a> {
    pub observation: Arc<AiObservation>,
    emitter: Arc<AiEmitter<'a>>,
    text: BTreeMap<AiContentBlock, String>,
    text_done: BTreeSet<AiContentBlock>,
    reasoning_seen: BTreeSet<AiContentBlock>,
    text_bytes: usize,
    reasoning_bytes: usize,
    text_limit: usize,
    reasoning_limit: usize,
    show_reasoning: bool,
    truncated: bool,
    policy: AiOutputPolicy,
    pub usage: AiUsage,
}

impl<'a> AiOutput<'a> {
    pub(crate) fn heartbeat(&self) {
        self.emitter.emit(AiStreamEventPayload::Heartbeat);
    }

    pub(crate) fn new(
        request: &AiCompletionRequest<'_>,
        observation: Arc<AiObservation>,
        emitter: Arc<AiEmitter<'a>>,
    ) -> Self {
        Self {
            observation,
            emitter,
            text: BTreeMap::new(),
            text_done: BTreeSet::new(),
            reasoning_seen: BTreeSet::new(),
            text_bytes: 0,
            reasoning_bytes: 0,
            text_limit: request.text.output_limit_bytes,
            reasoning_limit: request.reasoning_limit_bytes,
            show_reasoning: request.show_reasoning,
            truncated: false,
            policy: request.output_policy,
            usage: AiUsage::default(),
        }
    }

    pub(crate) fn phase(&self, phase: AiObservedPhase, block: Option<AiContentBlock>) {
        if self.observation.phase(phase) {
            self.emitter
                .emit(AiStreamEventPayload::PhaseChanged { phase, block });
        }
    }

    pub(crate) fn text(&mut self, block: AiContentBlock, text: &str) -> AppResult<()> {
        if self.text_done.contains(&block) {
            return Err(AiProviderErrorCode::Protocol.error());
        }
        if self.text_bytes.saturating_add(text.len()) > self.text_limit {
            return Err(AppError::custom(CustomErrorCode::AiOutputTooLarge));
        }
        self.text.entry(block).or_default().push_str(text);
        self.text_bytes += text.len();
        if !text.is_empty() {
            self.phase(AiObservedPhase::Text, Some(block));
            self.observation.text(text.len());
            self.emitter.emit(AiStreamEventPayload::TextDelta {
                block,
                text: text.into(),
            });
        }
        Ok(())
    }

    /// Count only actual nonempty wire deltas, not text recovered from a final snapshot.
    pub(crate) fn text_delta(&mut self, block: AiContentBlock, text: &str) -> AppResult<()> {
        self.text(block, text)?;
        if !text.is_empty() {
            self.observation.stream_text_delta();
        }
        Ok(())
    }

    pub(crate) fn text_done(&mut self, block: AiContentBlock, text: &str) -> AppResult<()> {
        match self.text.get(&block) {
            Some(previous)
                if previous.is_empty() && !text.is_empty() && !self.text_done.contains(&block) =>
            {
                self.text(block, text)?
            }
            Some(previous) if previous != text => return Err(AiProviderErrorCode::Protocol.error()),
            None => self.text(block, text)?,
            _ => {}
        }
        self.text_done.insert(block);
        Ok(())
    }

    pub(crate) fn text_blocks(&self) -> BTreeSet<AiContentBlock> {
        self.text.keys().copied().collect()
    }

    pub(crate) fn reasoning(
        &mut self,
        block: AiContentBlock,
        kind: AiReasoningKind,
        text: &str,
        done: bool,
    ) {
        if done && self.reasoning_seen.contains(&block) {
            return;
        }
        self.phase(AiObservedPhase::Reasoning, Some(block));
        if text.is_empty() {
            return;
        }
        self.reasoning_seen.insert(block);
        // Keep measuring semantic progress even after the visible buffer fills.
        self.observation.reasoning(text.len());
        if !self.show_reasoning || self.truncated {
            return;
        }
        let mut length = text
            .len()
            .min(self.reasoning_limit.saturating_sub(self.reasoning_bytes));
        while !text.is_char_boundary(length) {
            length -= 1;
        }
        if length > 0 {
            self.reasoning_bytes += length;
            self.emitter.emit(AiStreamEventPayload::ReasoningDelta {
                block,
                kind,
                text: text[..length].into(),
            });
        }
        if length < text.len() && !self.truncated {
            self.truncated = true;
            self.emitter.emit(AiStreamEventPayload::ReasoningTruncated);
        }
    }

    pub(crate) fn usage(&mut self, usage: AiUsage) {
        if usage.input_tokens.is_some() {
            self.usage.input_tokens = usage.input_tokens;
        }
        if usage.output_tokens.is_some() {
            self.usage.output_tokens = usage.output_tokens;
        }
        if usage.reasoning_tokens.is_some() {
            self.usage.reasoning_tokens = usage.reasoning_tokens;
        }
        self.emitter.emit(AiStreamEventPayload::Usage {
            usage: self.usage.clone(),
        });
    }

    pub(crate) fn finish(&self, reason: Option<&str>) -> AppResult<()> {
        let normalized = AiFinishReason::from_provider(reason);
        self.observation.finish(normalized);
        match normalized {
            AiFinishReason::Stop => Ok(()),
            AiFinishReason::Length => {
                Err(AiProviderErrorCode::LimitReached.with_finish_reason(reason))
            }
            AiFinishReason::Incomplete | AiFinishReason::Unknown => {
                Err(AiProviderErrorCode::Incomplete.with_finish_reason(reason))
            }
            _ => Err(AiProviderErrorCode::Failed.with_finish_reason(reason)),
        }
    }

    pub(crate) fn result(self) -> AppResult<AiCompletionResult> {
        let text = self.text.into_values().collect::<String>();
        if text.trim().is_empty() {
            return Err(AiProviderErrorCode::NoText.error());
        }
        if self.policy != AiOutputPolicy::Text {
            let value: serde_json::Value = serde_json::from_str(&text)
                .map_err(|_| AiProviderErrorCode::OutputInvalid.error())?;
            if self.policy == AiOutputPolicy::GameMove && !value.is_object() {
                return Err(AiProviderErrorCode::OutputInvalid.error());
            }
        }
        Ok(AiCompletionResult {
            text,
            usage: self.usage,
            diagnostics: self.observation.snapshot(),
        })
    }
}
