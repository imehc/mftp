//! Local rsync process ownership, bounded output capture and shutdown.
use super::preview::last_progress_bytes;
use crate::core::diagnostics::context;
use crate::error::{AppError, AppResult, CustomErrorCode};
use std::ffi::OsString;
use std::io::Read;
use std::os::unix::process::ExitStatusExt;
use std::path::Path;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::time::{Duration, Instant};

const CHILD_EXIT_GRACE: Duration = Duration::from_secs(10);
const CHILD_STOP_TIMEOUT: Duration = Duration::from_secs(5);
const STDOUT_LIMIT: usize = 512 * 1024;
const PROGRESS_TAIL_LIMIT: usize = 8 * 1024;
pub(super) const STDERR_LIMIT: usize = 32 * 1024;

pub(super) struct LocalRsync {
    child: Option<Child>,
    stdout: PipePump,
    stderr: PipePump,
    pub(super) stdout_capture: Vec<u8>,
    pub(super) stderr_capture: Vec<u8>,
    pub(super) stdout_total: u64,
    pub(super) stderr_total: u64,
    pub(super) progress_bytes: u64,
    progress_tail: Vec<u8>,
    pub(super) exit: Option<ExitStatus>,
    command_index: Option<usize>,
    command_closed: bool,
}

struct PipePump {
    receiver: Receiver<Vec<u8>>,
    reader: Option<std::thread::JoinHandle<()>>,
}

impl LocalRsync {
    pub(super) fn spawn(
        path: &Path,
        args: &[OsString],
        command_index: Option<usize>,
    ) -> AppResult<Self> {
        let mut child = Command::new(path)
            .args(args)
            .env_clear()
            .env("PATH", "/usr/bin:/bin")
            .env("LC_ALL", "C")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| {
                AppError::from(error)
                    .context("Starting local rsync")
                    .with_arg("path", path.display())
            })?;
        let Some(stdout) = child.stdout.take() else {
            stop_child(&mut child);
            return Err(missing_pipe("local rsync stdout was not captured"));
        };
        let Some(stderr) = child.stderr.take() else {
            stop_child(&mut child);
            return Err(missing_pipe("local rsync stderr was not captured"));
        };
        let stdout = match pump_pipe(stdout) {
            Ok(pump) => pump,
            Err(error) => {
                stop_child(&mut child);
                return Err(error);
            }
        };
        let stderr = match pump_pipe(stderr) {
            Ok(pump) => pump,
            Err(error) => {
                stop_child(&mut child);
                return Err(error);
            }
        };
        Ok(Self {
            child: Some(child),
            stdout,
            stderr,
            stdout_capture: Vec::new(),
            stderr_capture: Vec::new(),
            stdout_total: 0,
            stderr_total: 0,
            progress_bytes: 0,
            progress_tail: Vec::new(),
            exit: None,
            command_index,
            command_closed: false,
        })
    }

    pub(super) fn poll(&mut self) -> AppResult<()> {
        self.try_wait()?;
        self.drain();
        Ok(())
    }

    fn try_wait(&mut self) -> AppResult<()> {
        if self.exit.is_some() {
            return Ok(());
        }
        let Some(child) = self.child.as_mut() else {
            return Ok(());
        };
        match child.try_wait() {
            Ok(Some(status)) => self.exit = Some(status),
            Ok(None) => {}
            Err(error) => return Err(AppError::from(error).context("Waiting for local rsync")),
        }
        Ok(())
    }

    fn drain(&mut self) {
        let index = self.command_index;
        while let Ok(chunk) = self.stdout.receiver.try_recv() {
            self.stdout_total = self.stdout_total.saturating_add(chunk.len() as u64);
            if self.stdout_capture.len() < STDOUT_LIMIT {
                let keep = chunk.len().min(STDOUT_LIMIT - self.stdout_capture.len());
                self.stdout_capture.extend_from_slice(&chunk[..keep]);
            }
            if let Some(index) = index {
                context::record(|log| log.command_bytes(index, false, &chunk));
            }
            push_tail(&mut self.progress_tail, &chunk, PROGRESS_TAIL_LIMIT);
            let bytes = last_progress_bytes(&self.progress_tail);
            if bytes > self.progress_bytes {
                self.progress_bytes = bytes;
            }
        }
        while let Ok(chunk) = self.stderr.receiver.try_recv() {
            self.stderr_total = self.stderr_total.saturating_add(chunk.len() as u64);
            push_tail(&mut self.stderr_capture, &chunk, STDERR_LIMIT);
            if let Some(index) = index {
                context::record(|log| log.command_bytes(index, true, &chunk));
            }
        }
    }

    fn kill(&mut self) {
        if self.exit.is_some() {
            return;
        }
        let Some(child) = self.child.as_mut() else {
            return;
        };
        let _ = child.kill();
        if let Ok(status) = child.wait() {
            self.exit = Some(status);
        }
    }

    pub(super) fn finish(&mut self, kill: bool) -> AppResult<()> {
        if kill {
            self.kill();
        }
        if self.exit.is_none() {
            let deadline = Instant::now() + CHILD_EXIT_GRACE;
            while self.exit.is_none() && Instant::now() < deadline {
                self.try_wait()?;
                if self.exit.is_none() {
                    std::thread::sleep(Duration::from_millis(20));
                }
            }
        }
        if self.exit.is_none() {
            self.kill();
        }
        let deadline = Instant::now() + CHILD_STOP_TIMEOUT;
        while Instant::now() < deadline {
            self.drain();
            if self.stdout.finished() && self.stderr.finished() {
                break;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        self.stdout.join();
        self.stderr.join();
        self.drain();
        self.close_command();
        Ok(())
    }

    fn close_command(&mut self) {
        if self.command_closed {
            return;
        }
        self.command_closed = true;
        let Some(index) = self.command_index else {
            return;
        };
        let (code, signal) = match self.exit {
            Some(status) => (
                status.code(),
                status.signal().map(|signal| signal.to_string()),
            ),
            None => (None, None),
        };
        context::record(|log| log.command_end(index, code, signal.as_deref()));
    }
}

impl Drop for LocalRsync {
    fn drop(&mut self) {
        let _ = self.finish(true);
    }
}

impl PipePump {
    fn finished(&self) -> bool {
        self.reader
            .as_ref()
            .is_none_or(std::thread::JoinHandle::is_finished)
    }

    fn join(&mut self) {
        if let Some(handle) = self.reader.take() {
            if handle.is_finished() {
                let _ = handle.join();
            }
        }
    }
}

fn pump_pipe(mut reader: impl Read + Send + 'static) -> AppResult<PipePump> {
    let (tx, receiver) = mpsc::sync_channel(64);
    let handle = std::thread::Builder::new()
        .name("rsync-local-output".into())
        .spawn(move || {
            let mut buffer = vec![0u8; 32 * 1024];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(count) => {
                        if tx.send(buffer[..count].to_vec()).is_err() {
                            break;
                        }
                    }
                }
            }
        })?;
    Ok(PipePump {
        receiver,
        reader: Some(handle),
    })
}

fn stop_child(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

pub(super) fn missing_pipe(detail: &'static str) -> AppError {
    AppError::custom(CustomErrorCode::RsyncBridgeFailed).with_arg("detail", detail)
}

pub(super) fn push_tail(target: &mut Vec<u8>, chunk: &[u8], limit: usize) {
    target.extend_from_slice(chunk);
    if target.len() > limit {
        let excess = target.len() - limit;
        target.drain(..excess);
    }
}
