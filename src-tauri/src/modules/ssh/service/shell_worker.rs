use super::super::ports::{EventSink, SshEvent};
use super::diagnostics::ProtocolError;
use super::shell_lifecycle::ShellHandle;
use super::types::ShellJob;
use crate::core::diagnostics::context;
use crate::error::AppResult;
use serde_json::json;
use ssh2::Session;
use std::io::{Read, Write};
use std::sync::mpsc::{Receiver, TryRecvError};

// Keep the pump independent of ssh2 so final-output and control ordering can
// be exercised with deterministic short reads and failures.
trait ShellIo: Read + Write {
    fn eof(&self) -> bool;
    fn resize(&mut self, cols: u32, rows: u32);
    fn close(&mut self);
}

impl ShellIo for ssh2::Channel {
    fn eof(&self) -> bool {
        ssh2::Channel::eof(self)
    }
    fn resize(&mut self, cols: u32, rows: u32) {
        let _ = super::diagnostics::call(
            "ssh.resizePty",
            json!({"cols":cols,"rows":rows}),
            || self.request_pty_size(cols, rows, None, None),
            super::diagnostics::unit,
        );
    }
    fn close(&mut self) {
        let _ = super::diagnostics::call(
            "ssh.channelClose",
            json!({}),
            || ssh2::Channel::close(self),
            super::diagnostics::unit,
        );
        let _ = super::diagnostics::call(
            "ssh.waitClose",
            json!({}),
            || self.wait_close(),
            super::diagnostics::unit,
        );
    }
}

/// The thread owns its dedicated session. Completion is emitted only after
/// protocol resources drop; the caller's guard then releases the reservation.
pub(super) fn shell_worker(
    events: EventSink,
    session_id: String,
    sess: Session,
    channel: ssh2::Channel,
    rx: Receiver<ShellJob>,
    handle: &ShellHandle,
) -> AppResult<()> {
    // A short bounded poll applies to writes, resize and shutdown as well.
    sess.set_timeout(30);
    context::event(&json!({"event":"shellStarted","inputCaptured":false,"outputCaptured":false}));
    let result = run_shell(
        channel,
        &rx,
        || handle.is_closing(),
        |bytes| {
            events(SshEvent::Data {
                session_id: &session_id,
                bytes,
            });
        },
    );
    drop(sess);
    events(SshEvent::Closed {
        session_id: &session_id,
    });
    context::event(&json!({"event":"shellWorkerExited"}));
    result.map_err(Into::into)
}

fn run_shell(
    mut channel: impl ShellIo,
    rx: &Receiver<ShellJob>,
    closing: impl Fn() -> bool,
    mut output: impl FnMut(&[u8]),
) -> std::io::Result<()> {
    let mut buf = [0u8; 32 * 1024];
    let result = 'pump: loop {
        // Limit control work per poll so a continuous write queue cannot
        // starve output. Explicit stop has priority over queued writes.
        for _ in 0..64 {
            if closing() {
                break 'pump Ok(());
            }
            match rx.try_recv() {
                Ok(ShellJob::Write(data)) => {
                    if let Err(error) = channel.write_all(&data).and_then(|_| channel.flush()) {
                        context::event(
                            &json!({"event":"error","method":"ssh.shellWrite","error":error.diagnostic()}),
                        );
                        break 'pump Err(error);
                    }
                }
                Ok(ShellJob::Resize(cols, rows)) => channel.resize(cols, rows),
                Ok(ShellJob::Close) | Err(TryRecvError::Disconnected) => break 'pump Ok(()),
                Err(TryRecvError::Empty) => break,
            }
        }
        match channel.read(&mut buf) {
            Ok(0) if channel.eof() => break Ok(()),
            Ok(0) => {}
            // EOF may already be set while more than one buffer is pending.
            // Only a zero read proves the buffered final output is drained.
            Ok(n) => output(&buf[..n]),
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock
                        | std::io::ErrorKind::TimedOut
                        | std::io::ErrorKind::Interrupted
                ) => {}
            Err(error) => {
                context::event(
                    &json!({"event":"error","method":"ssh.shellRead","error":error.diagnostic()}),
                );
                break Err(error);
            }
        }
    };
    channel.close();
    result
}

#[cfg(test)]
#[path = "shell_worker_tests.rs"]
mod tests;
