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

fn emit_transfer_progress(
    app: Option<&AppHandle>,
    transfer_id: Option<&str>,
    phase: &str,
    transferred: u64,
    total: Option<u64>,
) {
    let (Some(app), Some(id)) = (app, transfer_id) else {
        return;
    };
    let _ = app.emit(
        "sftp-transfer-progress",
        TransferProgress {
            id: id.to_string(),
            phase: phase.to_string(),
            transferred,
            total,
        },
    );
}

/// How the backend should authenticate a session. Captured at connect time so
/// the shell and SFTP channels (separate TCP sessions) can each (re)connect.
#[derive(Clone)]
pub enum AuthMethod {
    Password(Option<String>),
    Key {
        path: PathBuf,
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
enum ShellJob {
    Write(Vec<u8>),
    Resize(u32, u32),
    Close,
}

struct ShellHandle {
    tx: Sender<ShellJob>,
}

/// A cached SFTP connection: the initialized subsystem plus the session that
/// backs it (reused both for SFTP ops and for `exec` channels running remote
/// commands like `tar` / `unzip`).
struct SftpConn {
    sftp: ssh2::Sftp,
    session: Session,
}

struct TransferFlag {
    control: Mutex<TransferControlState>,
    control_changed: Condvar,
    refs: AtomicUsize,
}

struct TransferControlState {
    cancelled: bool,
    paused: bool,
    pausable: bool,
}

enum TransferIoOutcome {
    Complete,
    Paused,
}

impl TransferFlag {
    fn new(cancelled: bool, paused: bool) -> Self {
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

struct TransferGuard {
    id: String,
    flag: Arc<TransferFlag>,
    transfers: Arc<Mutex<HashMap<String, Arc<TransferFlag>>>>,
}

impl TransferGuard {
    fn check(&self) -> AppResult<()> {
        let mut control = self.flag.control.lock();
        while control.paused && !control.cancelled {
            self.flag.control_changed.wait(&mut control);
        }
        if control.cancelled {
            return Err(AppError("传输已取消".into()));
        }
        Ok(())
    }

    fn enter_unpausable(&self) -> AppResult<()> {
        let mut control = self.flag.control.lock();
        while control.paused && !control.cancelled {
            self.flag.control_changed.wait(&mut control);
        }
        if control.cancelled {
            return Err(AppError("传输已取消".into()));
        }
        control.pausable = false;
        Ok(())
    }

    /// Used inside SFTP I/O loops that currently hold a shared connection
    /// lock. Returning a private pause signal lets the caller drop the handle
    /// before waiting, so browsing and other transfers stay responsive.
    fn io_paused(&self) -> AppResult<bool> {
        let control = self.flag.control.lock();
        if control.cancelled {
            return Err(AppError("传输已取消".into()));
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
    auth: Mutex<HashMap<String, AuthMaterial>>,
    shells: Mutex<HashMap<String, ShellHandle>>,
    /// Lazily-created SFTP connections (one per session). Cached so that the
    /// SFTP subsystem is initialized only once, not on every operation.
    sftp: Mutex<HashMap<String, Arc<Mutex<SftpConn>>>>,
    transfers: Arc<Mutex<HashMap<String, Arc<TransferFlag>>>>,
    local_temps: Mutex<HashSet<PathBuf>>,
    local_temp_journal: PathBuf,
}
