use tokio::time::Instant;

use parking_lot::Mutex;

use super::{AiCompletionDiagnostics, AiFinishReason, AiObservedPhase};
use crate::error::AppError;
use crate::modules::ai::AiProtocol;

/// The byte stream and text callback share counters, never response contents.
pub(crate) struct AiObservation {
    started: Instant,
    data: Mutex<AiCompletionDiagnostics>,
}

impl AiObservation {
    pub(crate) fn new(protocol: AiProtocol) -> Self {
        Self {
            started: Instant::now(),
            data: Mutex::new(AiCompletionDiagnostics {
                protocol,
                phase: AiObservedPhase::Connecting,
                elapsed_ms: 0,
                received_bytes: 0,
                received_text_bytes: 0,
                stream_text_delta_count: 0,
                received_reasoning_bytes: 0,
                had_reasoning_activity: false,
                last_transport_activity_ms: None,
                last_reasoning_progress_ms: None,
                last_text_progress_ms: None,
                finish_reason: None,
                response_started_ms: None,
                first_event_ms: None,
                phase_started_ms: 0,
                hard_deadline_ms: 0,
            }),
        }
    }

    pub(crate) fn elapsed_ms(&self) -> u32 {
        self.started.elapsed().as_millis().min(u32::MAX as u128) as u32
    }

    pub(crate) fn response_started(&self) {
        self.phase(AiObservedPhase::Waiting);
        self.data.lock().response_started_ms = Some(self.elapsed_ms());
    }

    pub(crate) fn received(&self, bytes: usize) {
        if bytes == 0 {
            return;
        }
        let mut data = self.data.lock();
        data.received_bytes = data
            .received_bytes
            .saturating_add(bytes.min(u32::MAX as usize) as u32);
    }

    pub(crate) fn accepted_event(&self) {
        let mut data = self.data.lock();
        let now = self.elapsed_ms();
        data.first_event_ms.get_or_insert(now);
        data.last_transport_activity_ms = Some(now);
    }

    pub(crate) fn transport_activity(&self) {
        self.data.lock().last_transport_activity_ms = Some(self.elapsed_ms());
    }

    pub(crate) fn phase(&self, phase: AiObservedPhase) -> bool {
        let mut data = self.data.lock();
        if data.phase == phase {
            return false;
        }
        data.phase = phase;
        data.phase_started_ms = self.elapsed_ms();
        true
    }

    pub(crate) fn reasoning(&self, bytes: usize) {
        if bytes == 0 {
            return;
        }
        self.phase(AiObservedPhase::Reasoning);
        let mut data = self.data.lock();
        data.had_reasoning_activity = true;
        data.received_reasoning_bytes = data
            .received_reasoning_bytes
            .saturating_add(bytes.min(u32::MAX as usize) as u32);
        data.last_reasoning_progress_ms = Some(self.elapsed_ms());
    }

    pub(crate) fn finish(&self, reason: AiFinishReason) {
        self.data.lock().finish_reason = Some(reason);
    }

    pub(crate) fn deadline(&self, milliseconds: u32) {
        self.data.lock().hard_deadline_ms = milliseconds;
    }

    pub(crate) fn at(&self, milliseconds: u32) -> Instant {
        self.started + std::time::Duration::from_millis(milliseconds.into())
    }

    pub(crate) fn stream_text_delta(&self) {
        let mut data = self.data.lock();
        data.stream_text_delta_count = data.stream_text_delta_count.saturating_add(1);
    }

    pub(crate) fn text(&self, bytes: usize) {
        if bytes == 0 {
            return;
        }
        self.phase(AiObservedPhase::Text);
        let mut data = self.data.lock();
        data.received_text_bytes = data
            .received_text_bytes
            .saturating_add(bytes.min(u32::MAX as usize) as u32);
        data.last_text_progress_ms = Some(self.elapsed_ms());
    }

    pub(crate) fn snapshot(&self) -> AiCompletionDiagnostics {
        let mut data = self.data.lock().clone();
        data.elapsed_ms = self.elapsed_ms();
        data
    }

    pub(crate) fn annotate(&self, mut error: AppError) -> AppError {
        let data = self.snapshot();
        error = error
            .with_arg("protocol", data.protocol.as_str())
            .with_arg("phase", data.phase.as_str())
            .with_arg("elapsedMs", data.elapsed_ms)
            .with_arg("receivedBytes", data.received_bytes)
            .with_arg("receivedTextBytes", data.received_text_bytes)
            .with_arg("receivedReasoningBytes", data.received_reasoning_bytes)
            .with_arg("hardDeadlineMs", data.hard_deadline_ms)
            .with_arg("hadReasoningActivity", data.had_reasoning_activity);
        if let Some(reason) = data.finish_reason {
            error = error.with_arg("finishReason", reason.as_str());
        }
        for (name, time) in [
            ("lastTransportActivityMs", data.last_transport_activity_ms),
            ("lastReasoningProgressMs", data.last_reasoning_progress_ms),
            ("lastTextProgressMs", data.last_text_progress_ms),
        ] {
            if let Some(time) = time {
                error = error.with_arg(name, time);
            }
        }
        error
    }
}
