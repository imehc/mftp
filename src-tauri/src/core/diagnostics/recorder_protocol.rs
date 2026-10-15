use super::recorder::{bounded, RawBody};
use super::{
    DiagnosticBodyEnd, DiagnosticDetail, DiagnosticPhase, DiagnosticProgress, DiagnosticRecorder,
};
use serde::Serialize;
use std::io::{self, Write};
use std::time::Duration;

struct TraceWriter<'a>(&'a mut RawBody);

impl Write for TraceWriter<'_> {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.0.append(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl DiagnosticRecorder {
    pub(crate) fn safe_bytes(&self, bytes: &[u8]) -> super::DiagnosticText {
        let mut body = RawBody::new();
        body.append(bytes);
        body.end = DiagnosticBodyEnd::Complete;
        body.view(&self.redactor)
    }

    pub(crate) fn correlation(&mut self, id: &str) {
        let (safe, redacted) = self.redactor.text(id);
        self.local.redacted |= redacted;
        self.local.metadata_truncated |= safe.len() > 512;
        self.local.correlation_id = Some(bounded(&safe, 512));
        self.publish();
    }

    pub(crate) fn protocol_event(&mut self, event: &impl Serialize) {
        if self.finished {
            return;
        }
        // Serialize incrementally into a bounded private buffer. Large directory
        // results must not require an additional unbounded diagnostic allocation.
        let _ = serde_json::to_writer(TraceWriter(&mut self.trace), event);
        self.trace.append(b"\n");
        self.local.phase = DiagnosticPhase::Executing;
        self.publish_throttled();
    }

    pub(crate) fn progress(&mut self, phase: &str, completed: u64, total: Option<u64>) {
        self.local.progress = Some(DiagnosticProgress {
            phase: bounded(&self.redactor.text(phase).0, 256),
            completed: completed as f64,
            total: total.map(|value| value as f64),
        });
        self.publish_throttled();
    }

    pub(crate) fn command(&mut self, command: &str, capture_stdout: bool) -> Option<usize> {
        if self.local.details.len() >= 4 {
            self.local.discarded_details = self.local.discarded_details.saturating_add(1);
            return None;
        }
        let index = self.local.details.len();
        let mut raw = RawBody::new();
        raw.append(command.as_bytes());
        raw.end = DiagnosticBodyEnd::Complete;
        let stdout = RawBody::new();
        let stderr = RawBody::new();
        self.local.details.push(DiagnosticDetail::Command {
            command: raw.view(&self.redactor),
            stdout: stdout.view(&self.redactor),
            stderr: stderr.view(&self.redactor),
            stdout_captured: capture_stdout,
            exit_status: None,
            exit_signal: None,
        });
        self.bodies.push(raw);
        self.command_bodies.push((index, stdout, stderr));
        self.publish();
        Some(index)
    }

    pub(crate) fn command_bytes(&mut self, index: usize, stderr: bool, bytes: &[u8]) {
        let capture = stderr
            || matches!(
                self.local.details.get(index),
                Some(DiagnosticDetail::Command {
                    stdout_captured: true,
                    ..
                })
            );
        if let Some((_, out, err)) = self
            .command_bodies
            .iter_mut()
            .find(|(id, _, _)| *id == index)
        {
            let body = if stderr { err } else { out };
            if capture {
                body.append(bytes);
            } else {
                body.received = body.received.saturating_add(bytes.len() as u64);
            }
        }
        self.publish_throttled();
    }

    pub(crate) fn command_end(&mut self, index: usize, status: Option<i32>, signal: Option<&str>) {
        if let Some(DiagnosticDetail::Command {
            exit_status,
            exit_signal,
            ..
        }) = self.local.details.get_mut(index)
        {
            *exit_status = status;
            *exit_signal = signal.map(|signal| bounded(&self.redactor.text(signal).0, 512));
        }
        if let Some((_, out, err)) = self
            .command_bodies
            .iter_mut()
            .find(|(id, _, _)| *id == index)
        {
            out.end = DiagnosticBodyEnd::Complete;
            err.end = DiagnosticBodyEnd::Complete;
        }
        self.publish();
    }

    fn publish_throttled(&mut self) {
        if self.published.elapsed() >= Duration::from_millis(100) {
            self.publish();
        }
    }

    pub(super) fn refresh_protocol(&mut self) {
        if self.trace.received > 0 {
            self.local.trace = Some(self.trace.view(&self.redactor));
        }
        for (index, out, err) in &self.command_bodies {
            if let Some(DiagnosticDetail::Command { stdout, stderr, .. }) =
                self.local.details.get_mut(*index)
            {
                *stdout = out.view(&self.redactor);
                *stderr = err.view(&self.redactor);
            }
        }
    }

    pub(super) fn end_protocol(&mut self) {
        self.trace.end = DiagnosticBodyEnd::Complete;
        for (_, out, err) in &mut self.command_bodies {
            for body in [out, err] {
                if body.end == DiagnosticBodyEnd::Receiving {
                    body.end = DiagnosticBodyEnd::Interrupted;
                }
            }
        }
    }
}
