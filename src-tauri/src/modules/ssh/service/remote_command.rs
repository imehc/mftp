use super::auth::connect;
use super::remote_command_io::{execute, retry_until, POLL_INTERVAL};
use super::transfer_retry::AttemptError;
use super::types::{AuthMaterial, Manager, TransferGuard};
use crate::error::{AppError, AppResult, CustomErrorCode};
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

const CAPTURE_LIMIT: usize = 16 * 1024 * 1024;

impl Manager {
    pub(super) fn command_control(
        &self,
        session_id: &str,
        material: &Arc<AuthMaterial>,
        transfer: Option<&TransferGuard>,
    ) -> AppResult<bool> {
        let paused = transfer
            .map(TransferGuard::io_paused)
            .transpose()?
            .unwrap_or(false);
        if self.operations.is_closed() {
            return Err(AppError::custom(CustomErrorCode::AppShuttingDown));
        }
        self.ensure_material(&self.auth.lock(), session_id, material)?;
        Ok(paused)
    }

    pub(super) fn exec(&self, session_id: &str, command: &str) -> AppResult<(i32, String, String)> {
        self.exec_controlled(session_id, command, None)
    }

    fn exec_controlled(
        &self,
        session_id: &str,
        command: &str,
        transfer: Option<&TransferGuard>,
    ) -> AppResult<(i32, String, String)> {
        let material = self.material(session_id)?;
        self.command_control(session_id, &material, transfer)?;
        let session = connect(&material)?;
        let mut stdout = Vec::new();
        let result = execute(
            &session,
            command,
            || {
                // A remote mutation cannot be paused halfway through. Its caller
                // enters the unpausable phase, but cancellation still interrupts IO.
                self.command_control(session_id, &material, transfer)
                    .map(|_| false)
            },
            |bytes| {
                if stdout.len().saturating_add(bytes.len()) > CAPTURE_LIMIT {
                    return Err(AttemptError::local(AppError::ssh_invalid_response(
                        "Remote command output exceeds the capture limit",
                    )));
                }
                stdout.extend_from_slice(bytes);
                Ok(())
            },
        )
        .map_err(AttemptError::into_error)?;
        let stdout = String::from_utf8(stdout)
            .map_err(|_| std::io::Error::from(std::io::ErrorKind::InvalidData))?;
        Ok((result.exit_code, stdout, result.stderr))
    }

    pub(super) fn exec_checked(&self, session_id: &str, command: &str) -> AppResult<String> {
        self.exec_checked_transfer(session_id, command, None)
    }

    pub(super) fn exec_checked_transfer(
        &self,
        session_id: &str,
        command: &str,
        transfer: Option<&TransferGuard>,
    ) -> AppResult<String> {
        let (code, stdout, stderr) = self.exec_controlled(session_id, command, transfer)?;
        if code != 0 {
            return Err(AppError::ssh_remote_exit(
                code,
                if stderr.trim().is_empty() {
                    &stdout
                } else {
                    &stderr
                },
            ));
        }
        Ok(stdout)
    }

    /// An exclusively reserved empty marker becomes one byte only after the
    /// command succeeds. No cached connection is invalidated by confirmation.
    pub(super) fn confirm_remote_command_marker(
        &self,
        session_id: &str,
        marker: &str,
        transfer: Option<&TransferGuard>,
    ) -> AppResult<bool> {
        let material = self.material(session_id)?;
        let mut control = || self.command_control(session_id, &material, transfer);
        control()?;
        let session = connect(&material)?;
        session.set_blocking(false);
        let deadline = Instant::now() + Duration::from_secs(30);
        let sftp = retry_until(|| session.sftp(), &mut control, deadline)
            .map_err(AttemptError::into_error)?;
        loop {
            control()?;
            let stat = retry_until(|| sftp.lstat(Path::new(marker)), &mut control, deadline)
                .map_err(AttemptError::into_error)?;
            if stat.size == Some(1) {
                return Ok(true);
            }
            if stat.size.is_none() {
                return Err(AppError::ssh_invalid_response(
                    "SFTP marker response omitted file size",
                ));
            }
            if Instant::now() >= deadline {
                return Ok(false);
            }
            let next = (Instant::now() + Duration::from_millis(500)).min(deadline);
            while Instant::now() < next {
                control()?;
                std::thread::sleep(POLL_INTERVAL);
            }
        }
    }
}

#[cfg(test)]
#[path = "remote_command_tests.rs"]
mod tests;
