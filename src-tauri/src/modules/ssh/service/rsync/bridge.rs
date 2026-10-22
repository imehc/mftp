//! Real rsync execution: local rsync runs with this executable as its remote
//! shell; the helper forwards the rsync wire protocol through a private Unix
//! socket; the app validates the server argv and bridges it over ssh2.

use super::super::temp_cleanup::TrackedLocalTemp;
use super::super::types::{AuthMaterial, Manager, TransferGuard};
use super::preview::last_progress_bytes;
use super::protocol::{
    decode_handshake, read_frame, validate_remote_command, HANDSHAKE_LIMIT, HELPER_NAME,
    SOCKET_FILE, TASK_PREFIX, TOKEN_FILE,
};
use super::spec::{build_args, direction_name, display_command, sync_specs};
use super::stream::{bridge_stream, RemoteOutcome};
use crate::core::diagnostics::context;
use crate::error::{AppError, AppResult, CustomErrorCode};
use crate::modules::ssh::ports::{emit_progress, EventSink};
use crate::modules::ssh::RsyncDirection;
use serde_json::json;
use std::ffi::OsString;
use std::io::{Read, Write};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};
use std::os::unix::net::{UnixListener, UnixStream};
use std::os::unix::process::ExitStatusExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::sync::Arc;
use std::time::{Duration, Instant};

const ACCEPT_TIMEOUT: Duration = Duration::from_secs(30);
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
const CHILD_EXIT_GRACE: Duration = Duration::from_secs(10);
const CHILD_STOP_TIMEOUT: Duration = Duration::from_secs(5);
const STDOUT_LIMIT: usize = 512 * 1024;
const PROGRESS_TAIL_LIMIT: usize = 8 * 1024;
pub(super) const STDERR_LIMIT: usize = 32 * 1024;

pub(super) struct BridgeOptions<'a> {
    pub(super) local_rsync: &'a Path,
    pub(super) remote_rsync: &'a str,
    pub(super) material: Arc<AuthMaterial>,
    pub(super) direction: RsyncDirection,
    pub(super) local_dir: &'a str,
    pub(super) remote_dir: &'a str,
    pub(super) delete_extraneous: bool,
    pub(super) dry_run: bool,
    pub(super) events: Option<&'a EventSink>,
    pub(super) transfer_id: Option<&'a str>,
    pub(super) transfer: Option<&'a TransferGuard>,
    pub(super) phase: &'a str,
}

pub(super) struct BridgeOutput {
    pub(super) exit_code: i32,
    pub(super) stdout: Vec<u8>,
    pub(super) stdout_truncated: bool,
    pub(super) stderr: String,
    /// Logical file bytes from rsync's progress2 output.
    pub(super) transferred_bytes: u64,
    /// Raw protocol bytes exchanged over the SSH channel.
    pub(super) network_bytes: u64,
}

struct TaskFiles<'a> {
    // Drop order matters: the socket and listener must close before the tracked
    // directory removes the socket file and journal entry.
    helper: PathBuf,
    token: String,
    listener: UnixListener,
    _tracked: TrackedLocalTemp<'a>,
}

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
    fn spawn(path: &Path, args: &[OsString], command_index: Option<usize>) -> AppResult<Self> {
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

    fn finish(&mut self, kill: bool) -> AppResult<()> {
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

#[cfg(test)]
pub(super) static TEST_HELPER_EXECUTABLE: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

fn helper_executable() -> AppResult<PathBuf> {
    #[cfg(test)]
    if let Some(path) = TEST_HELPER_EXECUTABLE.get() {
        return Ok(path.clone());
    }
    std::env::current_exe()
        .map_err(|error| AppError::from(error).context("Locating the app executable"))
}

fn missing_pipe(detail: &'static str) -> AppError {
    AppError::custom(CustomErrorCode::RsyncBridgeFailed).with_arg("detail", detail)
}

pub(super) fn push_tail(target: &mut Vec<u8>, chunk: &[u8], limit: usize) {
    target.extend_from_slice(chunk);
    if target.len() > limit {
        let excess = target.len() - limit;
        target.drain(..excess);
    }
}

impl Manager {
    pub(super) fn rsync_run(&self, options: BridgeOptions<'_>) -> AppResult<BridgeOutput> {
        let (source, destination) = sync_specs(&options)?;
        let task = self.create_task_files()?;
        let args = build_args(&options, &task.helper, &source, &destination);
        let display = display_command(options.local_rsync, &args);
        let local_index = context::record(|log| log.command(&display, true)).flatten();
        context::event(&json!({
            "event": "rsyncStart",
            "direction": direction_name(options.direction),
            "deleteExtraneous": options.delete_extraneous,
            "dryRun": options.dry_run,
            "protocolContentCaptured": false
        }));
        emit_progress(options.events, options.transfer_id, options.phase, 0, None);
        let mut local = LocalRsync::spawn(options.local_rsync, &args, local_index)?;
        let outcome = pump(&mut local, &task, &options);
        let finishing = local.finish(outcome.is_err());
        let result = match outcome {
            Ok(remote) => finishing.and_then(|()| classify(&local, remote)),
            Err(error) => Err(error),
        };
        if let Ok(output) = &result {
            if output.transferred_bytes > 0 {
                emit_progress(
                    options.events,
                    options.transfer_id,
                    options.phase,
                    output.transferred_bytes,
                    None,
                );
            }
        }
        context::event(&json!({
            "event": "rsyncEnd",
            "ok": result.is_ok(),
            "exitCode": local.exit.and_then(|status| status.code()),
            "stdoutBytes": local.stdout_total,
            "stderrBytes": local.stderr_total,
            "stderrTail": result.as_ref().ok().map(|output| first_line(&output.stderr)),
            "networkBytes": result.as_ref().ok().map(|output| output.network_bytes)
        }));
        result
    }

    fn create_task_files(&self) -> AppResult<TaskFiles<'_>> {
        let directory = self.create_task_directory()?;
        let tracked = match self.track_local_temp(directory.clone()) {
            Ok(tracked) => tracked,
            Err(error) => {
                let _ = std::fs::remove_dir_all(&directory);
                return Err(error);
            }
        };
        let token = uuid::Uuid::new_v4().simple().to_string();
        let mut token_file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(directory.join(TOKEN_FILE))?;
        token_file.write_all(token.as_bytes())?;
        drop(token_file);
        let helper = directory.join(HELPER_NAME);
        let executable = helper_executable()?;
        std::os::unix::fs::symlink(executable, &helper)?;
        let socket_path = directory.join(SOCKET_FILE);
        let listener = UnixListener::bind(&socket_path)?;
        std::fs::set_permissions(&socket_path, std::fs::Permissions::from_mode(0o600))?;
        Ok(TaskFiles {
            helper,
            token,
            listener,
            _tracked: tracked,
        })
    }

    fn create_task_directory(&self) -> AppResult<PathBuf> {
        let mut last_error = None;
        for base in task_bases() {
            match unique_task_dir(&base) {
                Ok(directory) => return Ok(directory),
                Err(error) => last_error = Some(error),
            }
        }
        if let Some(error) = last_error {
            return Err(error);
        }
        Err(missing_pipe("no private temporary directory is available"))
    }
}

fn task_bases() -> Vec<PathBuf> {
    let mut bases = vec![std::env::temp_dir(), PathBuf::from("/tmp")];
    bases.dedup();
    bases.retain(|base| {
        base.is_dir()
            && !base
                .as_os_str()
                .as_bytes()
                .iter()
                .any(u8::is_ascii_whitespace)
            && probe_socket_path(base) <= 100
    });
    bases
}

fn probe_socket_path(base: &Path) -> usize {
    base.join(format!("{TASK_PREFIX}000000000000"))
        .join(SOCKET_FILE)
        .as_os_str()
        .as_bytes()
        .len()
}

fn unique_task_dir(base: &Path) -> AppResult<PathBuf> {
    for _ in 0..16 {
        let id = uuid::Uuid::new_v4().simple().to_string();
        let directory = base.join(format!("{TASK_PREFIX}{}", &id[..12]));
        let mut builder = std::fs::DirBuilder::new();
        builder.mode(0o700);
        match builder.create(&directory) {
            Ok(()) => return Ok(directory),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(AppError::from(error)
                    .context("Creating the rsync task directory")
                    .with_arg("path", base.display()));
            }
        }
    }
    Err(missing_pipe("could not create a unique task directory"))
}

fn pump(
    local: &mut LocalRsync,
    task: &TaskFiles<'_>,
    options: &BridgeOptions<'_>,
) -> AppResult<RemoteOutcome> {
    let mut stream = accept_helper(local, task, options)?;
    // BSD inherits O_NONBLOCK from the listener; the handshake must block until
    // the helper's frame arrives.
    stream
        .set_nonblocking(false)
        .map_err(|error| AppError::from(error).context("Configuring the rsync bridge"))?;
    stream
        .set_read_timeout(Some(HANDSHAKE_TIMEOUT))
        .map_err(|error| AppError::from(error).context("Configuring the rsync bridge"))?;
    let payload = read_frame(&mut &stream, HANDSHAKE_LIMIT)
        .map_err(|error| bridge_error(error, "reading the helper handshake"))?;
    let handshake = decode_handshake(&payload)
        .map_err(|error| bridge_error(error, "decoding the helper handshake"))?;
    if handshake.token != task.token {
        return Err(
            AppError::custom(CustomErrorCode::RsyncRemoteCommandRejected)
                .with_arg("reason", "helper token mismatch"),
        );
    }
    validate_remote_command(&handshake.argv, options.remote_rsync, options.direction)?;
    stream
        .write_all(&[1])
        .and_then(|()| stream.flush())
        .map_err(|error| bridge_error(error, "acknowledging the helper"))?;
    stream
        .set_read_timeout(None)
        .map_err(|error| AppError::from(error).context("Configuring the rsync bridge"))?;
    stream
        .set_nonblocking(true)
        .map_err(|error| AppError::from(error).context("Configuring the rsync bridge"))?;
    bridge_stream(stream, &handshake.argv, options, local)
}

fn accept_helper(
    local: &mut LocalRsync,
    task: &TaskFiles<'_>,
    options: &BridgeOptions<'_>,
) -> AppResult<UnixStream> {
    task.listener
        .set_nonblocking(true)
        .map_err(|error| AppError::from(error).context("Configuring the rsync bridge"))?;
    let deadline = Instant::now() + ACCEPT_TIMEOUT;
    loop {
        if let Some(transfer) = options.transfer {
            transfer.check()?;
        }
        match task.listener.accept() {
            Ok((stream, _)) => return Ok(stream),
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(error) => return Err(bridge_error(error, "accepting the rsync helper")),
        }
        local.poll()?;
        if let Some(status) = local.exit {
            return Err(if status.success() {
                missing_pipe("local rsync exited before the helper connected")
            } else {
                local_exit(Some(status))
            });
        }
        if Instant::now() >= deadline {
            return Err(AppError::custom(CustomErrorCode::RsyncBridgeTimeout)
                .with_arg("detail", "the rsync helper did not connect"));
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn classify(local: &LocalRsync, remote: RemoteOutcome) -> AppResult<BridgeOutput> {
    let local_code = local.exit.and_then(|status| status.code());
    if let Some(code) = remote.exit.filter(|code| *code != 0) {
        let detail = first_line(&remote.stderr);
        let detail = if detail.is_empty() {
            first_line(&String::from_utf8_lossy(&local.stderr_capture))
        } else {
            detail
        };
        return Err(AppError::custom(CustomErrorCode::RsyncRemoteExit)
            .with_arg("exitCode", code)
            .with_arg("detail", detail));
    }
    if local_code != Some(0) {
        return Err(local_exit(local.exit).with_arg(
            "detail",
            first_line(&String::from_utf8_lossy(&local.stderr_capture)),
        ));
    }
    if remote.exit != Some(0) {
        return Err(missing_pipe("remote rsync exit status is unavailable")
            .with_arg("diagnostic", first_line(&remote.stderr)));
    }
    Ok(BridgeOutput {
        exit_code: 0,
        stdout: local.stdout_capture.clone(),
        stdout_truncated: local.stdout_total > local.stdout_capture.len() as u64,
        stderr: String::from_utf8_lossy(&local.stderr_capture).into_owned(),
        transferred_bytes: local.progress_bytes,
        network_bytes: remote.network_bytes,
    })
}

pub(super) fn local_exit(status: Option<ExitStatus>) -> AppError {
    let code = status.and_then(|status| status.code());
    let mut error = AppError::custom(CustomErrorCode::RsyncLocalExit).with_arg(
        "exitCode",
        code.map_or_else(|| "unknown".to_string(), |code| code.to_string()),
    );
    if let Some(signal) = status.and_then(|status| status.signal()) {
        error = error.with_arg("signal", signal.to_string());
    }
    error
}

pub(super) fn bridge_error(error: impl std::fmt::Display, detail: &'static str) -> AppError {
    AppError::custom(CustomErrorCode::RsyncBridgeFailed)
        .with_arg("detail", detail)
        .with_arg("reason", error.to_string())
}

fn first_line(text: &str) -> String {
    text.lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("")
        .trim()
        .chars()
        .take(1024)
        .collect()
}

#[cfg(test)]
#[path = "bridge_tests.rs"]
mod tests;
