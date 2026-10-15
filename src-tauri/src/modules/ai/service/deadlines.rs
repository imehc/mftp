use crate::error::AppResult;
use crate::modules::ai::completion::{
    AiCompletionDiagnostics, AiControlMessage, AiEmitter, AiObservation, AiObservedPhase,
    AiProviderErrorCode, AiStreamEventPayload, AiTimeoutPolicy, AiTimeoutStage,
};
use std::{future::Future, sync::Arc};
use tokio::sync::mpsc::Receiver;

pub(super) struct WaitContext<'a> {
    pub observation: Arc<AiObservation>,
    pub emitter: Arc<AiEmitter<'a>>,
    pub policy: AiTimeoutPolicy,
    pub streaming: bool,
    pub control: Option<&'a mut Receiver<AiControlMessage>>,
    pub soft_reported: bool,
}

pub(super) fn next_deadline(
    d: &AiCompletionDiagnostics,
    policy: AiTimeoutPolicy,
    streaming: bool,
) -> (u32, AiTimeoutStage) {
    let mut deadlines = vec![(d.hard_deadline_ms, AiTimeoutStage::HardDeadline)];
    if let Some(headers) = d.response_started_ms {
        if streaming {
            if d.first_event_ms.is_none() {
                deadlines.push((
                    headers.saturating_add(policy.first_event_ms),
                    AiTimeoutStage::FirstEvent,
                ));
            } else {
                deadlines.push((
                    d.last_transport_activity_ms
                        .unwrap_or(headers)
                        .saturating_add(policy.transport_idle_ms),
                    AiTimeoutStage::TransportIdle,
                ));
            }
        }
        let (last, interval, stage) = match d.phase {
            AiObservedPhase::Reasoning => (
                d.last_reasoning_progress_ms
                    .unwrap_or(d.phase_started_ms)
                    .max(d.phase_started_ms),
                policy.reasoning_progress_ms,
                AiTimeoutStage::ReasoningProgress,
            ),
            AiObservedPhase::Text => (
                d.last_text_progress_ms
                    .unwrap_or(d.phase_started_ms)
                    .max(d.phase_started_ms),
                policy.text_progress_ms,
                AiTimeoutStage::TextProgress,
            ),
            _ => (
                d.phase_started_ms,
                policy.unobserved_progress_ms,
                AiTimeoutStage::UnobservedProgress,
            ),
        };
        deadlines.push((last.saturating_add(interval), stage));
    } else {
        deadlines.push((policy.response_headers_ms, AiTimeoutStage::Connection));
    }
    // The absolute deadline wins ties, regardless of concurrent progress.
    deadlines
        .into_iter()
        .min_by_key(|(time, _)| *time)
        .unwrap_or((d.hard_deadline_ms, AiTimeoutStage::HardDeadline))
}

impl WaitContext<'_> {
    pub(super) fn check(&self) -> AppResult<()> {
        let snapshot = self.observation.snapshot();
        let (deadline, stage) = next_deadline(&snapshot, self.policy, self.streaming);
        if snapshot.elapsed_ms >= deadline {
            return Err(AiProviderErrorCode::timeout(stage));
        }
        Ok(())
    }

    pub(super) async fn wait<T>(
        &mut self,
        future: impl Future<Output = AppResult<T>>,
    ) -> AppResult<T> {
        // Pin once: soft notifications and extensions must never recreate/send the request.
        tokio::pin!(future);
        loop {
            self.check()?;
            let snapshot = self.observation.snapshot();
            let (deadline, _) = next_deadline(&snapshot, self.policy, self.streaming);
            let wake = if self.soft_reported {
                deadline
            } else {
                deadline.min(self.policy.soft_wait_ms)
            };
            tokio::select! {
                biased;
                _ = tokio::time::sleep_until(self.observation.at(wake)) => {
                    self.check()?;
                    if !self.soft_reported && self.observation.elapsed_ms() >= self.policy.soft_wait_ms {
                        self.soft_reported = true;
                        self.emitter.emit(AiStreamEventPayload::SoftWait { hard_deadline_ms: snapshot.hard_deadline_ms });
                    }
                }
                message = async {
                    match self.control.as_mut() {
                        Some(control) => control.recv().await,
                        None => std::future::pending().await,
                    }
                } => {
                    self.check()?;
                    match message {
                        Some(AiControlMessage::Extend { additional_ms }) => {
                            let new_deadline = snapshot.hard_deadline_ms.saturating_add(additional_ms);
                            if additional_ms > 0 && new_deadline <= self.policy.max_deadline_ms {
                                self.observation.deadline(new_deadline);
                                self.emitter.emit(AiStreamEventPayload::DeadlineExtended { hard_deadline_ms: new_deadline });
                            }
                        }
                        None | Some(AiControlMessage::Cancel) => return Err(AiProviderErrorCode::Cancelled.error()),
                    }
                }
                result = &mut future => { self.check()?; return result; }
            }
        }
    }
}

#[cfg(test)]
#[path = "deadlines_tests.rs"]
mod tests;
