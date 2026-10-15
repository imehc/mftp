use super::diagnostics::{call, unit, ProtocolError};
use super::transfer_retry::{AttemptError, AttemptResult};
use super::types::TransferIoOutcome;
use crate::core::diagnostics::context;
use crate::error::{AppError, AppResult};
use serde_json::json;
use std::io::{self, Read};
use std::time::{Duration, Instant};

pub(super) const POLL_INTERVAL: Duration = Duration::from_millis(25);
const PROTOCOL_TIMEOUT: Duration = Duration::from_secs(30);
const DIAGNOSTIC_LIMIT: usize = 16 * 1024;

pub(super) struct CommandOutput {
    pub(super) outcome: TransferIoOutcome,
    pub(super) exit_code: i32,
    pub(super) stderr: String,
}

trait OutputChannel {
    fn stdout(&mut self, buffer: &mut [u8]) -> io::Result<usize>;
    fn stderr(&mut self, buffer: &mut [u8]) -> io::Result<usize>;
    fn eof(&self) -> bool;
}

struct CommandChannel(ssh2::Channel, Option<usize>);

impl OutputChannel for CommandChannel {
    fn stdout(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        let result = self.0.read(buffer);
        if let (Some(index), Ok(size)) = (self.1, &result) {
            context::record(|log| log.command_bytes(index, false, &buffer[..*size]));
        }
        record_read_error("ssh.stdout", &result);
        result
    }
    fn stderr(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        let result = self.0.stderr().read(buffer);
        if let (Some(index), Ok(size)) = (self.1, &result) {
            context::record(|log| log.command_bytes(index, true, &buffer[..*size]));
        }
        record_read_error("ssh.stderr", &result);
        result
    }
    fn eof(&self) -> bool {
        self.0.eof()
    }
}

impl Drop for CommandChannel {
    fn drop(&mut self) {
        // Nonblocking best effort. Dropping our channel/session releases client
        // resources; it cannot prove that every remote descendant has exited.
        let _ = call("ssh.channelClose", json!({}), || self.0.close(), unit);
    }
}

/// Only use a dedicated session: nonblocking mode must never leak into the
/// shared SFTP cache. Quiet commands can run indefinitely while control stays
/// responsive; individual protocol handshakes retain a finite deadline.
pub(super) fn execute(
    session: &ssh2::Session,
    command: &str,
    capture_stdout: bool,
    mut control: impl FnMut() -> AppResult<bool>,
    output: impl FnMut(&[u8]) -> AttemptResult<()>,
) -> AttemptResult<CommandOutput> {
    session.set_blocking(false);
    let mut channel = CommandChannel(
        retry_ssh(
            || {
                call(
                    "ssh.channelSession",
                    json!({}),
                    || session.channel_session(),
                    unit,
                )
            },
            &mut control,
        )?,
        None,
    );
    channel.1 = context::record(|log| log.command(command, capture_stdout)).flatten();
    retry_ssh(
        || {
            call(
                "ssh.exec",
                json!({"command":command,"stdoutCaptured":capture_stdout}),
                || channel.0.exec(command),
                unit,
            )
        },
        &mut control,
    )?;
    // These commands never consume input. EOF prevents a remote tool from
    // waiting indefinitely for an interactive prompt.
    retry_ssh(
        || call("ssh.sendEof", json!({}), || channel.0.send_eof(), unit),
        &mut control,
    )?;
    let mut keepalive_at = Instant::now();
    let (outcome, stderr) = pump(&mut channel, &mut control, output, || {
        if keepalive_at.elapsed() >= Duration::from_secs(5) {
            match session.keepalive_send() {
                Ok(_) => {}
                Err(error) if is_pending(&error) => {}
                Err(error) => return Err(AttemptError::remote(error)),
            }
            keepalive_at = Instant::now();
        }
        std::thread::sleep(POLL_INTERVAL);
        Ok(())
    })?;
    if outcome == TransferIoOutcome::Paused {
        return Ok(CommandOutput {
            outcome,
            exit_code: 0,
            stderr,
        });
    }
    retry_ssh(
        || call("ssh.waitClose", json!({}), || channel.0.wait_close(), unit),
        &mut control,
    )?;
    let signal = call("ssh.exitSignal", json!({}), || channel.0.exit_signal(), |signal| json!({"signal":signal.exit_signal,"message":signal.error_message,"language":signal.lang_tag})).map_err(AttemptError::remote)?;
    if let Some(signal) = signal.exit_signal {
        if let Some(index) = channel.1 {
            context::record(|log| log.command_end(index, None, Some(&signal)));
        }
        return Err(AttemptError::remote(AppError::ssh_remote_exit(-1, &signal)));
    }
    let exit_code = call(
        "ssh.exitStatus",
        json!({}),
        || channel.0.exit_status(),
        |status| json!(status),
    )
    .map_err(AttemptError::remote)?;
    if let Some(index) = channel.1 {
        context::record(|log| log.command_end(index, Some(exit_code), None));
    }
    Ok(CommandOutput {
        outcome,
        exit_code,
        stderr,
    })
}

pub(super) fn is_pending(error: &ssh2::Error) -> bool {
    matches!(error.code(), ssh2::ErrorCode::Session(-37))
}

fn record_read_error(method: &str, result: &io::Result<usize>) {
    if let Err(error) = result {
        if !matches!(
            error.kind(),
            io::ErrorKind::WouldBlock | io::ErrorKind::Interrupted
        ) {
            context::event(&json!({"event":"error","method":method,"error":error.diagnostic()}));
        }
    }
}

pub(super) fn retry_ssh<T>(
    operation: impl FnMut() -> Result<T, ssh2::Error>,
    control: &mut impl FnMut() -> AppResult<bool>,
) -> AttemptResult<T> {
    retry_until(operation, control, Instant::now() + PROTOCOL_TIMEOUT)
}

pub(super) fn retry_until<T>(
    mut operation: impl FnMut() -> Result<T, ssh2::Error>,
    control: &mut impl FnMut() -> AppResult<bool>,
    deadline: Instant,
) -> AttemptResult<T> {
    loop {
        control().map_err(AttemptError::local)?;
        match operation() {
            Ok(result) => return Ok(result),
            Err(error) if is_pending(&error) => {
                if Instant::now() >= deadline {
                    return Err(AttemptError::remote(io::Error::from(
                        io::ErrorKind::TimedOut,
                    )));
                }
                std::thread::sleep(POLL_INTERVAL);
            }
            Err(error) => return Err(AttemptError::remote(error)),
        }
    }
}

fn pump(
    channel: &mut impl OutputChannel,
    mut control: impl FnMut() -> AppResult<bool>,
    mut output: impl FnMut(&[u8]) -> AttemptResult<()>,
    mut wait: impl FnMut() -> AttemptResult<()>,
) -> AttemptResult<(TransferIoOutcome, String)> {
    let mut buffer = [0; 64 * 1024];
    let mut diagnostics = Vec::new();
    loop {
        if control().map_err(AttemptError::local)? {
            return Ok((
                TransferIoOutcome::Paused,
                String::from_utf8_lossy(&diagnostics).into_owned(),
            ));
        }
        let stdout = read_ready(channel.stdout(&mut buffer))?;
        if let Some(count) = stdout.filter(|count| *count > 0) {
            output(&buffer[..count])?;
        }
        // Always drain stderr, even after the diagnostic cap. Reading stdout
        // to completion first can deadlock a remote process on its stderr pipe.
        let stderr = read_ready(channel.stderr(&mut buffer))?;
        if let Some(count) = stderr {
            let keep = count.min(DIAGNOSTIC_LIMIT - diagnostics.len());
            diagnostics.extend_from_slice(&buffer[..keep]);
        }
        if stdout == Some(0) && stderr == Some(0) && channel.eof() {
            return Ok((
                TransferIoOutcome::Complete,
                String::from_utf8_lossy(&diagnostics).into_owned(),
            ));
        }
        if stdout.unwrap_or(0) == 0 && stderr.unwrap_or(0) == 0 {
            wait()?;
        }
    }
}

fn read_ready(result: io::Result<usize>) -> AttemptResult<Option<usize>> {
    match result {
        Ok(count) => Ok(Some(count)),
        Err(error)
            if matches!(
                error.kind(),
                io::ErrorKind::WouldBlock | io::ErrorKind::Interrupted
            ) =>
        {
            Ok(None)
        }
        Err(error) => Err(AttemptError::remote(error)),
    }
}

#[cfg(test)]
#[path = "remote_command_io_tests.rs"]
mod tests;
