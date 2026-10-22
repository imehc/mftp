//! rsync discovery. Local candidates are probed by absolute path because a GUI
//! process does not inherit the user's interactive PATH. The remote probe uses
//! a dedicated SSH session and classifies structured exit codes; probe failures
//! become data, never a broken terminal session.

use super::super::auth;
use super::super::path_utils::shell_quote;
use super::super::types::{AuthMaterial, Manager};
use super::preview::PreviewRegistry;
use crate::error::AppResult;
use crate::modules::ssh::{RsyncCapabilities, RsyncStatus, RsyncToolStatus};
use parking_lot::Mutex;
use ssh2::Session;
use std::collections::HashMap;
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::time::{Duration, Instant};

const MIN_MAJOR: u32 = 3;
const MIN_MINOR: u32 = 1;
const MIN_PROTOCOL: u32 = 31;
const LOCAL_PROBE_TIMEOUT: Duration = Duration::from_secs(4);
const REMOTE_PROBE_TIMEOUT_MS: u32 = 10_000;
const REMOTE_OUTPUT_LIMIT: usize = 64 * 1024;
const REMOTE_STDERR_LIMIT: usize = 16 * 1024;

#[cfg(target_os = "macos")]
const LOCAL_CANDIDATES: &[&str] = &[
    "/opt/homebrew/bin/rsync",
    "/usr/local/bin/rsync",
    "/usr/bin/rsync",
];
#[cfg(target_os = "linux")]
const LOCAL_CANDIDATES: &[&str] = &["/usr/local/bin/rsync", "/usr/bin/rsync", "/bin/rsync"];

#[derive(Debug, PartialEq, Eq)]
struct VersionInfo {
    version: String,
    protocol: Option<u32>,
    major: u32,
    minor: u32,
}

#[derive(Debug)]
enum ProbeFailure {
    Timeout,
    Failed(String),
}

pub(crate) struct RsyncState {
    local: Mutex<Option<RsyncToolStatus>>,
    remote: Mutex<HashMap<String, Arc<Mutex<Option<RsyncToolStatus>>>>>,
    pub(super) previews: PreviewRegistry,
}

impl Default for RsyncState {
    fn default() -> Self {
        Self {
            local: Mutex::new(None),
            remote: Mutex::new(HashMap::new()),
            previews: PreviewRegistry::default(),
        }
    }
}

impl RsyncState {
    pub(crate) fn forget(&self, session_id: &str) {
        self.remote.lock().remove(session_id);
        self.previews.forget_session(session_id);
    }

    pub(crate) fn clear(&self) {
        self.remote.lock().clear();
        self.previews.clear();
    }

    fn remote_slot(&self, session_id: &str) -> Arc<Mutex<Option<RsyncToolStatus>>> {
        self.remote
            .lock()
            .entry(session_id.to_string())
            .or_default()
            .clone()
    }
}

impl Manager {
    pub(crate) fn rsync_local_status(&self, refresh: bool) -> RsyncToolStatus {
        let mut cached = self.rsync.local.lock();
        if !refresh {
            if let Some(status) = cached.as_ref() {
                return status.clone();
            }
        }
        let status = probe_local();
        *cached = Some(status.clone());
        status
    }

    /// Probe remote rsync on demand. Concurrent callers share one slot, so a
    /// second request waits for the first result instead of opening another
    /// SSH session. Results from a disconnected session are discarded.
    pub(crate) fn rsync_capabilities(
        &self,
        session_id: &str,
        refresh: bool,
    ) -> AppResult<RsyncCapabilities> {
        let material = self.material(session_id)?;
        let local = self.rsync_local_status(refresh);
        let slot = self.rsync.remote_slot(session_id);
        let mut remote = slot.lock();
        if !refresh {
            if let Some(status) = remote.as_ref() {
                return Ok(RsyncCapabilities {
                    local,
                    remote: status.clone(),
                });
            }
        }
        let status = probe_remote(&material);
        if self.material(session_id).is_ok() {
            *remote = Some(status.clone());
        }
        Ok(RsyncCapabilities {
            local,
            remote: status,
        })
    }
}

fn probe_local() -> RsyncToolStatus {
    let mut unsupported = None;
    let mut failed = None;
    for candidate in LOCAL_CANDIDATES {
        let path = Path::new(candidate);
        if !path.is_file() {
            continue;
        }
        match run_local_version(path) {
            Ok((true, output)) => match parse_version_output(&output) {
                Some(info) if is_supported(&info) => return available(path, &info),
                Some(info) => {
                    unsupported = Some(unsupported_status(
                        Some(path),
                        Some(&info),
                        "rsync is older than 3.1",
                    ))
                }
                None => {
                    unsupported = Some(unsupported_status(
                        Some(path),
                        None,
                        "the executable is not upstream rsync",
                    ))
                }
            },
            Ok((false, output)) => {
                failed = Some(failed_status(format!(
                    "{} exited with an error: {}",
                    path.display(),
                    first_line(&output)
                )))
            }
            Err(ProbeFailure::Timeout) => {
                failed = Some(timeout_status(format!(
                    "{} did not answer the version probe",
                    path.display()
                )))
            }
            Err(ProbeFailure::Failed(message)) => {
                failed = Some(failed_status(format!("{}: {message}", path.display())))
            }
        }
    }
    if let Some(status) = unsupported {
        return status;
    }
    if let Some(status) = failed {
        return status;
    }
    RsyncToolStatus {
        status: RsyncStatus::Missing,
        path: None,
        version: None,
        protocol: None,
        message: None,
    }
}

fn run_local_version(path: &Path) -> Result<(bool, String), ProbeFailure> {
    let mut child = Command::new(path)
        .arg("--version")
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| ProbeFailure::Failed(error.to_string()))?;
    let deadline = Instant::now() + LOCAL_PROBE_TIMEOUT;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(ProbeFailure::Timeout);
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(25)),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(ProbeFailure::Failed(error.to_string()));
            }
        }
    };
    let mut output = Vec::new();
    if let Some(mut stdout) = child.stdout.take() {
        stdout
            .read_to_end(&mut output)
            .map_err(|error| ProbeFailure::Failed(error.to_string()))?;
    }
    if let Some(mut stderr) = child.stderr.take() {
        let mut text = Vec::new();
        let _ = stderr.read_to_end(&mut text);
        output.extend_from_slice(&text);
    }
    Ok((
        status.success(),
        String::from_utf8_lossy(&output).into_owned(),
    ))
}

fn probe_remote(material: &AuthMaterial) -> RsyncToolStatus {
    let session = match auth::connect(material) {
        Ok(session) => session,
        Err(error) => {
            let message = format!("SSH connection failed: {}", error.message);
            return if error.code == "ssh:timed_out" {
                timeout_status(message)
            } else {
                failed_status(message)
            };
        }
    };
    let lookup = exec_capture(&session, "sh -c 'command -v rsync'");
    let output = match lookup {
        Ok(output) => output,
        Err(failure) => return failure_status(failure),
    };
    let path = output
        .stdout
        .lines()
        .next()
        .unwrap_or("")
        .trim()
        .to_string();
    if output.exit == 127 || path.is_empty() && output.exit != 0 {
        return RsyncToolStatus {
            status: RsyncStatus::Missing,
            path: None,
            version: None,
            protocol: None,
            message: None,
        };
    }
    if output.exit != 0 {
        return failed_status(format!(
            "remote shell could not locate rsync: {}",
            first_line(&output.stderr)
        ));
    }
    if !super::protocol::is_safe_remote_program(&path) {
        return unsupported_status(
            None,
            None,
            "the remote rsync path is not a supported absolute path",
        );
    }
    let probe = exec_capture(&session, &format!("{} --version", shell_quote(&path)));
    let output = match probe {
        Ok(output) => output,
        Err(failure) => return failure_status(failure),
    };
    if output.exit != 0 {
        return failed_status(format!(
            "remote rsync failed to start: {}",
            first_line(&output.stderr)
        ));
    }
    match parse_version_output(&output.stdout) {
        Some(info) if is_supported(&info) => available(Path::new(&path), &info),
        Some(info) => unsupported_status(
            Some(Path::new(&path)),
            Some(&info),
            "remote rsync is older than 3.1",
        ),
        None => unsupported_status(
            Some(Path::new(&path)),
            None,
            "the remote executable is not upstream rsync",
        ),
    }
}

struct ExecOutput {
    exit: i32,
    stdout: String,
    stderr: String,
}

fn exec_capture(session: &Session, command: &str) -> Result<ExecOutput, ProbeFailure> {
    session.set_timeout(REMOTE_PROBE_TIMEOUT_MS);
    let mut channel = session.channel_session().map_err(map_ssh)?;
    channel.exec(command).map_err(map_ssh)?;
    let captured = read_limited(&mut channel, REMOTE_OUTPUT_LIMIT).and_then(|stdout| {
        read_limited(&mut channel.stderr(), REMOTE_STDERR_LIMIT).map(|stderr| (stdout, stderr))
    });
    let (stdout, stderr) = match captured {
        Ok(output) => output,
        Err(error) => {
            // Dropping a timed-out session leaves the remote probe process
            // running; close its channel and signal the peer explicitly.
            let _ = channel.close();
            let _ = session.disconnect(None, "rsync probe aborted", None);
            return Err(error);
        }
    };
    if let Err(error) = channel.wait_close().map_err(map_ssh) {
        let _ = session.disconnect(None, "rsync probe aborted", None);
        return Err(error);
    }
    let exit = channel.exit_status().map_err(map_ssh)?;
    Ok(ExecOutput {
        exit,
        stdout,
        stderr,
    })
}

fn read_limited(reader: &mut impl Read, limit: usize) -> Result<String, ProbeFailure> {
    let mut output = Vec::new();
    let mut buffer = [0u8; 4096];
    loop {
        let count = reader.read(&mut buffer).map_err(map_io)?;
        if count == 0 {
            break;
        }
        if output.len() + count > limit {
            return Err(ProbeFailure::Failed(
                "probe output exceeded the size limit".into(),
            ));
        }
        output.extend_from_slice(&buffer[..count]);
    }
    String::from_utf8(output).map_err(|_| ProbeFailure::Failed("probe output was not UTF-8".into()))
}

fn map_ssh(error: ssh2::Error) -> ProbeFailure {
    if matches!(error.code(), ssh2::ErrorCode::Session(-9)) {
        ProbeFailure::Timeout
    } else {
        ProbeFailure::Failed(error.to_string())
    }
}

fn map_io(error: std::io::Error) -> ProbeFailure {
    if matches!(
        error.kind(),
        std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
    ) {
        ProbeFailure::Timeout
    } else {
        ProbeFailure::Failed(error.to_string())
    }
}

fn failure_status(failure: ProbeFailure) -> RsyncToolStatus {
    match failure {
        ProbeFailure::Timeout => timeout_status("rsync capability detection timed out".into()),
        ProbeFailure::Failed(message) => failed_status(message),
    }
}

fn parse_version_output(output: &str) -> Option<VersionInfo> {
    let line = output.lines().find(|line| !line.trim().is_empty())?;
    let rest = line.trim_start().strip_prefix("rsync")?;
    let rest = rest.trim_start().strip_prefix("version")?;
    let version = rest.split_whitespace().next()?.to_string();
    let (major, minor) = parse_major_minor(&version)?;
    let protocol = line
        .split("protocol version")
        .nth(1)
        .and_then(|rest| rest.split_whitespace().next())
        .and_then(|value| value.parse::<u32>().ok());
    Some(VersionInfo {
        version,
        protocol,
        major,
        minor,
    })
}

fn parse_major_minor(version: &str) -> Option<(u32, u32)> {
    let mut parts = version.split('.');
    let major = parts.next()?.parse::<u32>().ok()?;
    let minor = parts.next()?.parse::<u32>().ok()?;
    let patch = parts.next();
    if patch.is_some_and(|patch| patch.parse::<u32>().is_err()) {
        return None;
    }
    if parts.next().is_some() {
        return None;
    }
    Some((major, minor))
}

fn is_supported(info: &VersionInfo) -> bool {
    (info.major, info.minor) >= (MIN_MAJOR, MIN_MINOR)
        && info
            .protocol
            .is_none_or(|protocol| protocol >= MIN_PROTOCOL)
}

fn available(path: &Path, info: &VersionInfo) -> RsyncToolStatus {
    RsyncToolStatus {
        status: RsyncStatus::Available,
        path: Some(path.to_string_lossy().into_owned()),
        version: Some(info.version.clone()),
        protocol: info.protocol,
        message: None,
    }
}

fn unsupported_status(
    path: Option<&Path>,
    info: Option<&VersionInfo>,
    message: &str,
) -> RsyncToolStatus {
    RsyncToolStatus {
        status: RsyncStatus::Unsupported,
        path: path.map(|path| path.to_string_lossy().into_owned()),
        version: info.map(|info| info.version.clone()),
        protocol: info.and_then(|info| info.protocol),
        message: Some(message.into()),
    }
}

fn failed_status(message: String) -> RsyncToolStatus {
    RsyncToolStatus {
        status: RsyncStatus::Failed,
        path: None,
        version: None,
        protocol: None,
        message: Some(message),
    }
}

fn timeout_status(message: String) -> RsyncToolStatus {
    RsyncToolStatus {
        status: RsyncStatus::Timeout,
        path: None,
        version: None,
        protocol: None,
        message: Some(message),
    }
}

fn first_line(text: &str) -> String {
    text.lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("no diagnostic")
        .trim()
        .chars()
        .take(512)
        .collect()
}

#[cfg(test)]
#[path = "capability_tests.rs"]
mod tests;
