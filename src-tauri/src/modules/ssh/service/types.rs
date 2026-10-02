use super::monitor::MonitorSample;
use super::shell_lifecycle::ShellHandle;
use crate::core::operations::Operations;
use crate::error::{AppError, AppResult, CustomErrorCode};
use parking_lot::{Condvar, Mutex};
use ssh2::Session;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DirectoryTransferMode {
    Archive,
    Direct,
}

impl DirectoryTransferMode {
    pub fn parse(value: Option<&str>) -> Self {
        match value {
            Some("direct") => Self::Direct,
            Some("archive") | None => Self::Archive,
            Some(_) => Self::Archive,
        }
    }
}

/// How the backend should authenticate a session. Captured at connect time so
/// the shell and SFTP channels (separate TCP sessions) can each (re)connect.
#[derive(Clone)]
pub enum AuthMethod {
    Password(Option<String>),
    Key {
        private_key: String,
        passphrase: Option<String>,
    },
}

#[derive(Clone)]
pub struct AuthMaterial {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub method: AuthMethod,
    pub identity_files: Vec<PathBuf>,
}

/// Jobs sent to a shell worker thread.
pub(super) enum ShellJob {
    Write(Vec<u8>),
    Resize(u32, u32),
    Close,
}

/// A cached SFTP connection: the initialized subsystem plus the session that
/// backs it (reused both for SFTP ops and for `exec` channels running remote
/// commands like `tar` / `unzip`).
pub(super) struct SftpConn {
    pub(super) sftp: ssh2::Sftp,
    pub(super) session: Session,
}

#[derive(Default)]
pub(super) struct SftpSlot {
    // One initialization per slot; reset/disconnect detach it without waiting on IO.
    pub(super) connection: Mutex<Option<Arc<Mutex<SftpConn>>>>,
}

pub(super) struct TransferFlag {
    pub(super) control: Mutex<TransferControlState>,
    pub(super) control_changed: Condvar,
    pub(super) refs: AtomicUsize,
}

pub(super) struct TransferControlState {
    pub(super) cancelled: bool,
    pub(super) paused: bool,
    pub(super) pausable: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum TransferIoOutcome {
    Complete,
    Paused,
}

impl TransferFlag {
    pub(super) fn new(cancelled: bool, paused: bool) -> Self {
        Self {
            control: Mutex::new(TransferControlState {
                cancelled,
                paused,
                pausable: true,
            }),
            control_changed: Condvar::new(),
            refs: AtomicUsize::new(0),
        }
    }
}

pub(super) struct TransferGuard {
    pub(super) id: String,
    pub(super) flag: Arc<TransferFlag>,
    pub(super) transfers: Arc<Mutex<HashMap<String, Arc<TransferFlag>>>>,
}

impl TransferGuard {
    pub(super) fn check(&self) -> AppResult<()> {
        let mut control = self.flag.control.lock();
        while control.paused && !control.cancelled {
            self.flag.control_changed.wait(&mut control);
        }
        if control.cancelled {
            return Err(AppError::custom(CustomErrorCode::SftpTransferCancelled));
        }
        Ok(())
    }

    pub(super) fn wait_retry(&self, delay: std::time::Duration) -> AppResult<()> {
        let deadline = std::time::Instant::now() + delay;
        let mut control = self.flag.control.lock();
        while !control.cancelled {
            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            if remaining.is_zero() {
                return Ok(());
            }
            // Wake promptly on cancellation; the retry runner handles pause
            // only after releasing all connection and stream resources.
            self.flag.control_changed.wait_for(&mut control, remaining);
        }
        Err(AppError::custom(CustomErrorCode::SftpTransferCancelled))
    }

    pub(super) fn enter_unpausable(&self) -> AppResult<()> {
        let mut control = self.flag.control.lock();
        while control.paused && !control.cancelled {
            self.flag.control_changed.wait(&mut control);
        }
        if control.cancelled {
            return Err(AppError::custom(CustomErrorCode::SftpTransferCancelled));
        }
        control.pausable = false;
        Ok(())
    }

    /// Used inside SFTP I/O loops that currently hold a shared connection
    /// lock. Returning a private pause signal lets the caller drop the handle
    /// before waiting, so browsing and other transfers stay responsive.
    pub(super) fn io_paused(&self) -> AppResult<bool> {
        let control = self.flag.control.lock();
        if control.cancelled {
            return Err(AppError::custom(CustomErrorCode::SftpTransferCancelled));
        }
        Ok(control.paused)
    }
}

impl Drop for TransferGuard {
    fn drop(&mut self) {
        if self.flag.refs.fetch_sub(1, Ordering::SeqCst) != 1 {
            return;
        }
        let mut transfers = self.transfers.lock();
        if transfers
            .get(&self.id)
            .is_some_and(|current| Arc::ptr_eq(current, &self.flag))
        {
            transfers.remove(&self.id);
        }
    }
}

pub struct Manager {
    pub(super) auth: Mutex<HashMap<String, Arc<AuthMaterial>>>,
    pub(super) shells: Arc<Mutex<HashMap<String, Arc<ShellHandle>>>>,
    pub(super) operations: Arc<Operations>,
    pub(super) workers: Arc<Operations>,
    /// Lazily-created SFTP connections (one per session). Cached so that the
    /// SFTP subsystem is initialized only once, not on every operation.
    pub(super) sftp: Mutex<HashMap<String, Arc<SftpSlot>>>,
    pub(super) transfers: Arc<Mutex<HashMap<String, Arc<TransferFlag>>>>,
    pub(super) local_temps: Mutex<HashSet<PathBuf>>,
    pub(super) local_temp_journal: PathBuf,
    /// Last monitor snapshot per session (see `monitor.rs`): lets a stats
    /// poll compute rates against the previous poll instead of sleeping
    /// between two snapshots inside every call. Cleared on disconnect.
    pub(super) monitor: Mutex<HashMap<String, MonitorSample>>,
}
