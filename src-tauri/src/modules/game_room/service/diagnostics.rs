use crate::core::activity::{ActivitySink, OperationContext};
use crate::core::diagnostics::{DiagnosticRecorder, Diagnostics, Redactor};
use crate::error::AppError;
use parking_lot::Mutex;
use serde_json::json;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

#[derive(Clone, Default)]
pub(crate) struct RoomDiagnostics {
    pub(crate) diagnostics: Arc<Diagnostics>,
    pub(crate) activity: Option<Arc<dyn ActivitySink>>,
}

/// A sweep has hundreds of expected refused connections. Keep their actual
/// results in one bounded operation rather than flooding the activity list.
pub(super) struct ProbeDiagnostics {
    recorder: Mutex<Option<DiagnosticRecorder>>,
    skipped: AtomicUsize,
    logs: RoomDiagnostics,
    target: String,
}

impl ProbeDiagnostics {
    pub(super) fn new(logs: &RoomDiagnostics, target: &str) -> Self {
        Self {
            recorder: Mutex::new(
                logs.diagnostics
                    .begin("games", "discover_connections", target),
            ),
            skipped: AtomicUsize::new(0),
            logs: logs.clone(),
            target: target.into(),
        }
    }

    pub(super) fn connected(&self, peer: &str, error: Option<&AppError>) {
        let Some(mut guard) = self.recorder.try_lock() else {
            self.skipped.fetch_add(1, Ordering::Relaxed);
            return;
        };
        if let Some(log) = guard.as_mut() {
            log.protocol_event(&json!({"peer": peer, "error": error}));
        }
    }
}

impl Drop for ProbeDiagnostics {
    fn drop(&mut self) {
        if let Some(mut log) = self.recorder.get_mut().take() {
            log.protocol_event(
                &json!({"notCapturedConcurrentResults": self.skipped.load(Ordering::Relaxed)}),
            );
            let mut context = OperationContext::new("games", "discover_connections", &self.target);
            context.operation_id = Some(log.id().to_owned());
            log.finish(None);
            if let Some(activity) = &self.logs.activity {
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    activity.record(&context, None)
                }));
            }
        }
    }
}

impl RoomDiagnostics {
    /// Called only after real IO, with the exact prefix read or written.
    pub(super) fn frame(
        &self,
        direction: &'static str,
        peer: &str,
        bytes: &[u8],
        complete: bool,
        error: Option<&AppError>,
    ) {
        let Some(mut log) = self.diagnostics.begin("games", direction, peer) else {
            return;
        };
        let mut redactor = Redactor::default();
        // Partial frames cannot establish credential boundaries. Only sanitized
        // complete JSON enters the shared recorder; omitted bodies are explicit.
        let sanitized = super::redaction::sanitize(bytes, &mut redactor);
        let captured = sanitized.is_some() || bytes.is_empty();
        let (body, redacted) = match sanitized {
            Some((safe, redacted)) => (Some(String::from_utf8_lossy(&safe).into_owned()), redacted),
            None if bytes.is_empty() => (Some(String::new()), false),
            None => (None, false),
        };
        let safe_error = error.cloned().map(|error| redactor.error(error));
        log.protocol_event(&json!({
            "direction": direction,
            "peer": peer,
            "bytes": bytes.len(),
            "complete": complete,
            "body": body,
            "redacted": redacted,
            "notCaptured": if captured || bytes.is_empty() { None } else { Some("Malformed, partial or credential-heavy frame") },
            "error": safe_error,
        }));
        let mut context = OperationContext::new("games", direction, peer);
        context.operation_id = Some(log.id().to_owned());
        log.finish(safe_error.as_ref());
        if let Some(activity) = &self.activity {
            // Activity storage queues into the existing bounded file writer.
            // A diagnostic failure must never change an already completed IO.
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                activity.record(&context, safe_error.as_ref())
            }));
        }
    }
}

#[cfg(test)]
#[path = "diagnostics_tests.rs"]
mod tests;
