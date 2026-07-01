use crate::error::{AppError, AppResult};
use crate::models::{SftpEntry, TransferProgress};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use parking_lot::Mutex;
use ssh2::{ErrorCode, FileStat, Session};
use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::{Read, Seek, SeekFrom, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{Receiver, Sender};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const SFTP_KEEPALIVE_INTERVAL_SECS: u32 = 15;
const SFTP_TRANSFER_RETRIES: usize = 3;
const LIBSSH2_ERROR_SOCKET_SEND: i32 = -7;
const LIBSSH2_ERROR_TIMEOUT: i32 = -9;
const LIBSSH2_ERROR_SOCKET_DISCONNECT: i32 = -13;
const LIBSSH2_ERROR_SOCKET_TIMEOUT: i32 = -30;
const LIBSSH2_ERROR_SOCKET_RECV: i32 = -43;
const LIBSSH2_ERROR_BAD_SOCKET: i32 = -45;

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
    Password(String),
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
    cancelled: AtomicBool,
    refs: AtomicUsize,
}

impl TransferFlag {
    fn new(cancelled: bool) -> Self {
        Self {
            cancelled: AtomicBool::new(cancelled),
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
        if self.flag.cancelled.load(Ordering::SeqCst) {
            Err(AppError("传输已取消".into()))
        } else {
            Ok(())
        }
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

#[derive(Default)]
pub struct Manager {
    auth: Mutex<HashMap<String, AuthMaterial>>,
    shells: Mutex<HashMap<String, ShellHandle>>,
    /// Lazily-created SFTP connections (one per session). Cached so that the
    /// SFTP subsystem is initialized only once, not on every operation.
    sftp: Mutex<HashMap<String, Arc<Mutex<SftpConn>>>>,
    transfers: Arc<Mutex<HashMap<String, Arc<TransferFlag>>>>,
}

/// Open + authenticate a blocking ssh2 session.
fn connect(mat: &AuthMaterial) -> AppResult<Session> {
    let tcp = TcpStream::connect((mat.host.as_str(), mat.port))
        .map_err(|e| AppError(format!("connect {}:{} failed: {e}", mat.host, mat.port)))?;
    let mut sess = Session::new()?;
    sess.set_tcp_stream(tcp);
    sess.handshake()?;
    match &mat.method {
        AuthMethod::Password(pw) => {
            sess.userauth_password(&mat.username, pw)?;
        }
        AuthMethod::Key { path, passphrase } => {
            sess.userauth_pubkey_file(&mat.username, None, path, passphrase.as_deref())?;
        }
    }
    if !sess.authenticated() {
        return Err(AppError("authentication failed".into()));
    }
    sess.set_keepalive(true, SFTP_KEEPALIVE_INTERVAL_SECS);
    Ok(sess)
}

fn stale_session_error(err: &ssh2::Error) -> bool {
    matches!(
        err.code(),
        ErrorCode::Session(
            LIBSSH2_ERROR_SOCKET_SEND
                | LIBSSH2_ERROR_TIMEOUT
                | LIBSSH2_ERROR_SOCKET_DISCONNECT
                | LIBSSH2_ERROR_SOCKET_TIMEOUT
                | LIBSSH2_ERROR_SOCKET_RECV
                | LIBSSH2_ERROR_BAD_SOCKET
        )
    )
}

fn stale_app_error(err: &AppError) -> bool {
    let msg = err.0.to_lowercase();
    msg.contains("timed out waiting on socket")
        || msg.contains("operation timed out")
        || msg.contains("socket timeout")
        || msg.contains("socket disconnect")
        || msg.contains("connection reset")
        || msg.contains("broken pipe")
}

fn transfer_cancelled_error(err: &AppError) -> bool {
    err.0 == "传输已取消"
}

fn sftp_entries(read_dir: Vec<(PathBuf, FileStat)>) -> Vec<SftpEntry> {
    let mut entries = Vec::new();
    for (p, stat) in read_dir {
        let name = p
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        if name.is_empty() {
            continue;
        }
        entries.push(SftpEntry {
            name,
            path: p.to_string_lossy().to_string(),
            is_dir: stat.is_dir(),
            is_symlink: stat.file_type().is_symlink(),
            size: stat.size.unwrap_or(0),
            mtime: stat.mtime.unwrap_or(0),
            mode: stat.perm.unwrap_or(0),
        });
    }
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    entries
}

impl Manager {
    /// Register auth material under a new/again session id (no I/O yet).
    pub fn register(&self, session_id: &str, mat: AuthMaterial) {
        self.auth.lock().insert(session_id.to_string(), mat);
    }

    fn material(&self, session_id: &str) -> AppResult<AuthMaterial> {
        self.auth
            .lock()
            .get(session_id)
            .cloned()
            .ok_or_else(|| AppError(format!("unknown session: {session_id}")))
    }

    /// Open an interactive shell on a dedicated worker thread.
    pub fn open_shell(
        &self,
        app: AppHandle,
        session_id: &str,
        cols: u32,
        rows: u32,
    ) -> AppResult<()> {
        let mut shells = self.shells.lock();
        if shells.contains_key(session_id) {
            return Ok(()); // already open
        }
        let mat = self.material(session_id)?;
        let sess = connect(&mat)?;

        let mut channel = sess.channel_session()?;
        channel.request_pty("xterm-256color", None, Some((cols, rows, 0, 0)))?;
        channel.shell()?;

        let (tx, rx) = std::sync::mpsc::channel::<ShellJob>();
        shells.insert(session_id.to_string(), ShellHandle { tx });
        drop(shells);

        let id = session_id.to_string();
        std::thread::spawn(move || {
            shell_worker(app, id, sess, channel, rx);
        });
        Ok(())
    }

    pub fn write(&self, session_id: &str, data: &[u8]) -> AppResult<()> {
        let shells = self.shells.lock();
        let handle = shells
            .get(session_id)
            .ok_or_else(|| AppError("shell not open".into()))?;
        handle
            .tx
            .send(ShellJob::Write(data.to_vec()))
            .map_err(|_| AppError("shell closed".into()))
    }

    pub fn resize(&self, session_id: &str, cols: u32, rows: u32) -> AppResult<()> {
        let shells = self.shells.lock();
        if let Some(handle) = shells.get(session_id) {
            let _ = handle.tx.send(ShellJob::Resize(cols, rows));
        }
        Ok(())
    }

    pub fn disconnect(&self, session_id: &str) {
        if let Some(handle) = self.shells.lock().remove(session_id) {
            let _ = handle.tx.send(ShellJob::Close);
        }
        self.sftp.lock().remove(session_id);
        self.auth.lock().remove(session_id);
    }

    // ---- SFTP ----

    pub fn cancel_transfer(&self, transfer_id: &str) {
        let mut transfers = self.transfers.lock();
        let flag = transfers
            .entry(transfer_id.to_string())
            .or_insert_with(|| Arc::new(TransferFlag::new(true)));
        flag.cancelled.store(true, Ordering::SeqCst);
    }

    fn transfer_guard(&self, transfer_id: Option<&str>) -> Option<TransferGuard> {
        let id = transfer_id?.to_string();
        let mut transfers = self.transfers.lock();
        let flag = transfers
            .entry(id.clone())
            .or_insert_with(|| Arc::new(TransferFlag::new(false)))
            .clone();
        flag.refs.fetch_add(1, Ordering::SeqCst);
        Some(TransferGuard {
            id,
            flag,
            transfers: self.transfers.clone(),
        })
    }

    /// Get (or lazily create) the SFTP connection for this session. The SFTP
    /// subsystem is initialized once here and reused for every subsequent call.
    fn sftp_conn(&self, session_id: &str) -> AppResult<Arc<Mutex<SftpConn>>> {
        let cached = { self.sftp.lock().get(session_id).cloned() };
        if let Some(conn) = cached {
            return Ok(conn);
        }
        let mat = self.material(session_id)?;
        let sess = connect(&mat)?;
        let sftp = sess.sftp()?;
        let arc = Arc::new(Mutex::new(SftpConn {
            sftp,
            session: sess,
        }));
        let mut sftp = self.sftp.lock();
        if let Some(current) = sftp.get(session_id) {
            return Ok(current.clone());
        }
        sftp.insert(session_id.to_string(), arc.clone());
        Ok(arc)
    }

    fn remove_sftp_conn_if_current(&self, session_id: &str, conn: &Arc<Mutex<SftpConn>>) {
        let mut sftp = self.sftp.lock();
        if sftp
            .get(session_id)
            .is_some_and(|current| Arc::ptr_eq(current, conn))
        {
            sftp.remove(session_id);
        }
    }

    pub fn sftp_home(&self, session_id: &str) -> AppResult<String> {
        let conn = self.sftp_conn(session_id)?;
        let conn = conn.lock();
        // realpath(".") resolves the login directory.
        let home = conn.sftp.realpath(Path::new("."))?;
        Ok(home.to_string_lossy().to_string())
    }

    /// Resolve the directory to open first: the host's configured default if it
    /// exists, otherwise the login/home directory, otherwise "/".
    pub fn sftp_start_dir(&self, session_id: &str, preferred: Option<&str>) -> AppResult<String> {
        let conn = self.sftp_conn(session_id)?;
        let conn = conn.lock();
        if let Some(p) = preferred {
            let p = p.trim();
            if !p.is_empty() {
                // stat() succeeds only if the path exists and is reachable.
                if let Ok(stat) = conn.sftp.stat(Path::new(p)) {
                    if stat.is_dir() {
                        if let Ok(real) = conn.sftp.realpath(Path::new(p)) {
                            return Ok(real.to_string_lossy().to_string());
                        }
                        return Ok(p.to_string());
                    }
                }
            }
        }
        // Fall back to the home directory, then root.
        match conn.sftp.realpath(Path::new(".")) {
            Ok(home) => Ok(home.to_string_lossy().to_string()),
            Err(_) => Ok("/".to_string()),
        }
    }

    pub fn sftp_list(&self, session_id: &str, path: &str) -> AppResult<Vec<SftpEntry>> {
        let conn = self.sftp_conn(session_id)?;
        let base = Path::new(path);
        let read_dir = {
            let conn_guard = conn.lock();
            conn_guard.sftp.readdir(base)
        };
        let read_dir = match read_dir {
            Ok(read_dir) => read_dir,
            Err(e) if stale_session_error(&e) => {
                self.remove_sftp_conn_if_current(session_id, &conn);
                let retry = self.sftp_conn(session_id)?;
                let retry = retry.lock();
                retry.sftp.readdir(base)?
            }
            Err(e) => return Err(e.into()),
        };
        Ok(sftp_entries(read_dir))
    }

    pub fn sftp_mkdir(&self, session_id: &str, path: &str) -> AppResult<()> {
        let conn = self.sftp_conn(session_id)?;
        let conn = conn.lock();
        conn.sftp.mkdir(Path::new(path), 0o755)?;
        Ok(())
    }

    pub fn sftp_rename(&self, session_id: &str, from: &str, to: &str) -> AppResult<()> {
        let conn = self.sftp_conn(session_id)?;
        let conn = conn.lock();
        conn.sftp.rename(Path::new(from), Path::new(to), None)?;
        Ok(())
    }

    pub fn sftp_delete(&self, session_id: &str, path: &str, is_dir: bool) -> AppResult<()> {
        let conn = self.sftp_conn(session_id)?;
        let conn = conn.lock();
        if is_dir {
            // Recursively remove directory contents, then the directory itself.
            remove_dir_recursive(&conn.sftp, Path::new(path))?;
        } else {
            conn.sftp.unlink(Path::new(path))?;
        }
        Ok(())
    }

    /// Download a remote file to a local path.
    pub fn sftp_download(
        &self,
        session_id: &str,
        remote: &str,
        local: &str,
        app: Option<&AppHandle>,
        transfer_id: Option<&str>,
    ) -> AppResult<()> {
        let transfer = self.transfer_guard(transfer_id);
        let total = self.sftp_conn(session_id).ok().and_then(|conn| {
            let conn = conn.lock();
            conn.sftp.stat(Path::new(remote)).ok()?.size
        });
        let mut local_file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(local)?;
        let mut buf = [0u8; 32 * 1024];
        let mut transferred = 0u64;
        let mut last_emit = Instant::now();
        let mut attempts = 0usize;

        emit_transfer_progress(app, transfer_id, "下载中", 0, total);
        loop {
            if let Some(transfer) = &transfer {
                if let Err(e) = transfer.check() {
                    let _ = std::fs::remove_file(local);
                    return Err(e);
                }
            }
            let conn = self.sftp_conn(session_id)?;
            let transfer_result: AppResult<()> = {
                let conn_guard = conn.lock();
                let mut remote_file = conn_guard.sftp.open(Path::new(remote))?;
                if transferred > 0 {
                    remote_file.seek(SeekFrom::Start(transferred))?;
                    local_file.seek(SeekFrom::Start(transferred))?;
                }
                loop {
                    if let Some(transfer) = &transfer {
                        transfer.check()?;
                    }
                    let n = remote_file.read(&mut buf)?;
                    if n == 0 {
                        break Ok(());
                    }
                    local_file.write_all(&buf[..n])?;
                    transferred += n as u64;
                    if last_emit.elapsed() >= Duration::from_millis(120) {
                        emit_transfer_progress(app, transfer_id, "下载中", transferred, total);
                        last_emit = Instant::now();
                    }
                }
            };
            match transfer_result {
                Ok(()) => break,
                Err(e) if attempts < SFTP_TRANSFER_RETRIES && stale_app_error(&e) => {
                    attempts += 1;
                    self.remove_sftp_conn_if_current(session_id, &conn);
                    emit_transfer_progress(app, transfer_id, "重连后继续下载", transferred, total);
                    std::thread::sleep(Duration::from_millis(250));
                }
                Err(e) => {
                    if transfer_cancelled_error(&e) {
                        let _ = std::fs::remove_file(local);
                    }
                    return Err(e);
                }
            }
        }
        if let Some(transfer) = &transfer {
            if let Err(e) = transfer.check() {
                let _ = std::fs::remove_file(local);
                return Err(e);
            }
        }
        emit_transfer_progress(app, transfer_id, "完成", transferred, total);
        Ok(())
    }

    /// Upload a local file to a remote path.
    pub fn sftp_upload(
        &self,
        session_id: &str,
        local: &str,
        remote: &str,
        app: Option<&AppHandle>,
        transfer_id: Option<&str>,
    ) -> AppResult<()> {
        let transfer = self.transfer_guard(transfer_id);
        let conn = self.sftp_conn(session_id)?;
        let conn = conn.lock();
        let total = std::fs::metadata(local).ok().map(|meta| meta.len());
        let mut local_file = std::fs::File::open(local)?;
        let mut remote_file = conn.sftp.create(Path::new(remote))?;
        let mut buf = [0u8; 32 * 1024];
        let mut transferred = 0u64;
        let mut last_emit = Instant::now();
        emit_transfer_progress(app, transfer_id, "上传中", 0, total);
        let result: AppResult<()> = loop {
            if let Some(transfer) = &transfer {
                transfer.check()?;
            }
            let n = local_file.read(&mut buf)?;
            if n == 0 {
                break Ok(());
            }
            if let Some(transfer) = &transfer {
                transfer.check()?;
            }
            remote_file.write_all(&buf[..n])?;
            transferred += n as u64;
            if last_emit.elapsed() >= Duration::from_millis(120) {
                emit_transfer_progress(app, transfer_id, "上传中", transferred, total);
                last_emit = Instant::now();
            }
        };
        if let Err(e) = result {
            if transfer_cancelled_error(&e) {
                let _ = conn.sftp.unlink(Path::new(remote));
            }
            return Err(e);
        }
        if let Some(transfer) = &transfer {
            if let Err(e) = transfer.check() {
                let _ = conn.sftp.unlink(Path::new(remote));
                return Err(e);
            }
        }
        emit_transfer_progress(app, transfer_id, "完成", transferred, total);
        Ok(())
    }

    // ---- Remote command execution + archive helpers ----

    /// Run a remote command over an `exec` channel; return (exit_code, stdout, stderr).
    fn exec(&self, session_id: &str, cmd: &str) -> AppResult<(i32, String, String)> {
        let conn = self.sftp_conn(session_id)?;
        let conn = conn.lock();
        // Ensure blocking mode with no stray timeout from the shell poller.
        conn.session.set_blocking(true);
        conn.session.set_timeout(0);
        let mut channel = conn.session.channel_session()?;
        channel.exec(cmd)?;
        let mut stdout = String::new();
        channel.read_to_string(&mut stdout)?;
        let mut stderr = String::new();
        channel.stderr().read_to_string(&mut stderr)?;
        channel.wait_close()?;
        let code = channel.exit_status()?;
        Ok((code, stdout, stderr))
    }

    /// Run a command and turn a non-zero exit into an error carrying stderr.
    fn exec_checked(&self, session_id: &str, cmd: &str) -> AppResult<String> {
        let (code, stdout, stderr) = self.exec(session_id, cmd)?;
        if code != 0 {
            let msg = if stderr.trim().is_empty() {
                stdout.trim().to_string()
            } else {
                stderr.trim().to_string()
            };
            return Err(AppError(format!("远端命令失败 (exit {code}): {msg}")));
        }
        Ok(stdout)
    }

    /// Whether a remote path exists.
    pub fn sftp_exists(&self, session_id: &str, path: &str) -> AppResult<bool> {
        let conn = self.sftp_conn(session_id)?;
        let conn = conn.lock();
        Ok(conn.sftp.stat(Path::new(path)).is_ok())
    }

    /// Upload a local directory: pack it locally into a tar.gz whose top-level
    /// entry is `remote_name`, stream the archive up, then extract remotely.
    pub fn sftp_upload_dir(
        &self,
        session_id: &str,
        local_dir: &str,
        remote_parent: &str,
        remote_name: &str,
        app: Option<&AppHandle>,
        transfer_id: Option<&str>,
    ) -> AppResult<()> {
        let transfer = self.transfer_guard(transfer_id);
        // 1. Build a local tar.gz with `remote_name` as the top directory.
        let local_archive = std::env::temp_dir().join(format!("mftp-up-{}.tar.gz", uuid_v4()));
        emit_transfer_progress(app, transfer_id, "压缩中", 0, None);
        if let Some(transfer) = &transfer {
            transfer.check()?;
        }
        pack_tar_gz(local_dir, remote_name, &local_archive)?;
        if let Some(transfer) = &transfer {
            if let Err(e) = transfer.check() {
                let _ = std::fs::remove_file(&local_archive);
                return Err(e);
            }
        }

        // 2. Upload it to a hidden temp file in the remote parent.
        let remote_archive = join_remote(remote_parent, &format!(".mftp-up-{}.tar.gz", uuid_v4()));
        let upload_res = self.sftp_upload(
            session_id,
            &local_archive.to_string_lossy(),
            &remote_archive,
            app,
            transfer_id,
        );
        // Local temp no longer needed once uploaded (or on failure).
        let _ = std::fs::remove_file(&local_archive);
        upload_res?;
        if let Some(transfer) = &transfer {
            if let Err(e) = transfer.check() {
                let _ = self.exec(
                    session_id,
                    &format!("rm -f {}", shell_quote(&remote_archive)),
                );
                return Err(e);
            }
        }

        // 3. Extract remotely, then remove the remote temp archive regardless.
        emit_transfer_progress(app, transfer_id, "远端解压中", 0, None);
        let cmd = format!(
            "tar -xzf {} -C {}",
            shell_quote(&remote_archive),
            shell_quote(remote_parent)
        );
        let extract_res = self.exec_checked(session_id, &cmd).map(|_| ());
        let _ = self.exec(
            session_id,
            &format!("rm -f {}", shell_quote(&remote_archive)),
        );
        extract_res
    }

    /// Stream a remote directory as tar.gz directly to a local archive.
    pub fn sftp_download_dir(
        &self,
        session_id: &str,
        remote_dir: &str,
        local_archive: &str,
        app: Option<&AppHandle>,
        transfer_id: Option<&str>,
    ) -> AppResult<()> {
        let transfer = self.transfer_guard(transfer_id);
        let mat = self.material(session_id)?;
        let parent = remote_parent_of(remote_dir);
        let name = remote_basename(remote_dir);
        let remote_stderr = format!("/tmp/.mftp-dl-{}.stderr", uuid_v4());
        let cmd = format!(
            "tar -czf - -C {} {} 2> {}",
            shell_quote(&parent),
            shell_quote(&name),
            shell_quote(&remote_stderr)
        );
        let mut attempts = 0usize;

        loop {
            if let Some(transfer) = &transfer {
                if let Err(e) = transfer.check() {
                    let _ = std::fs::remove_file(local_archive);
                    return Err(e);
                }
            }
            let sess = match connect(&mat) {
                Ok(sess) => sess,
                Err(e) if attempts < SFTP_TRANSFER_RETRIES && stale_app_error(&e) => {
                    attempts += 1;
                    emit_transfer_progress(app, transfer_id, "重连后重新下载文件夹", 0, None);
                    std::thread::sleep(Duration::from_millis(250));
                    continue;
                }
                Err(e) => return Err(e),
            };
            let result: AppResult<()> = {
                sess.set_blocking(true);
                sess.set_timeout(0);
                let mut channel = sess.channel_session()?;
                channel.exec(&cmd)?;

                let mut local_file = OpenOptions::new()
                    .create(true)
                    .write(true)
                    .truncate(true)
                    .open(local_archive)?;
                let mut buf = [0u8; 32 * 1024];
                let mut transferred = 0u64;
                let mut last_emit = Instant::now();

                emit_transfer_progress(app, transfer_id, "远端打包并下载中", 0, None);
                loop {
                    if let Some(transfer) = &transfer {
                        transfer.check()?;
                    }
                    let n = channel.read(&mut buf)?;
                    if n == 0 {
                        break;
                    }
                    local_file.write_all(&buf[..n])?;
                    transferred += n as u64;
                    if last_emit.elapsed() >= Duration::from_millis(120) {
                        emit_transfer_progress(
                            app,
                            transfer_id,
                            "远端打包并下载中",
                            transferred,
                            None,
                        );
                        last_emit = Instant::now();
                    }
                }
                local_file.flush()?;
                if let Some(transfer) = &transfer {
                    transfer.check()?;
                }

                if let Err(e) = channel.wait_close() {
                    if stale_session_error(&e) {
                        if let Some(transfer) = &transfer {
                            if let Err(e) = transfer.check() {
                                let _ = remove_remote_file(&sess, &remote_stderr);
                                let _ = std::fs::remove_file(local_archive);
                                return Err(e);
                            }
                        }
                        let _ = remove_remote_file(&sess, &remote_stderr);
                        emit_transfer_progress(app, transfer_id, "完成", transferred, None);
                        return Ok(());
                    }
                    return Err(e.into());
                }
                let code = match channel.exit_status() {
                    Ok(code) => code,
                    Err(e) if stale_session_error(&e) => {
                        if let Some(transfer) = &transfer {
                            if let Err(e) = transfer.check() {
                                let _ = remove_remote_file(&sess, &remote_stderr);
                                let _ = std::fs::remove_file(local_archive);
                                return Err(e);
                            }
                        }
                        let _ = remove_remote_file(&sess, &remote_stderr);
                        emit_transfer_progress(app, transfer_id, "完成", transferred, None);
                        return Ok(());
                    }
                    Err(e) => return Err(e.into()),
                };
                if code != 0 {
                    let stderr = read_remote_text_and_remove(&sess, &remote_stderr)
                        .unwrap_or_else(|_| String::new());
                    let msg = if stderr.trim().is_empty() {
                        "tar failed".to_string()
                    } else {
                        stderr.trim().to_string()
                    };
                    return Err(AppError(format!("远端命令失败 (exit {code}): {msg}")));
                }

                let _ = remove_remote_file(&sess, &remote_stderr);
                if let Some(transfer) = &transfer {
                    if let Err(e) = transfer.check() {
                        let _ = std::fs::remove_file(local_archive);
                        return Err(e);
                    }
                }
                emit_transfer_progress(app, transfer_id, "完成", transferred, None);
                Ok(())
            };

            match result {
                Ok(()) => return Ok(()),
                Err(e) if attempts < SFTP_TRANSFER_RETRIES && stale_app_error(&e) => {
                    attempts += 1;
                    let _ = remove_remote_file(&sess, &remote_stderr);
                    emit_transfer_progress(app, transfer_id, "重连后重新下载文件夹", 0, None);
                    std::thread::sleep(Duration::from_millis(250));
                }
                Err(e) => {
                    let _ = remove_remote_file(&sess, &remote_stderr);
                    if transfer_cancelled_error(&e) {
                        let _ = std::fs::remove_file(local_archive);
                    }
                    return Err(e);
                }
            }
        }
    }

    /// Extract a remote archive into `remote_parent`.
    ///
    /// When `out_name` is `Some`, the archive is extracted into a temporary
    /// staging dir first, then placed as a single directory named `out_name`
    /// (a lone top-level dir is unwrapped/renamed; multiple entries are wrapped).
    /// This makes the result name predictable and lets the caller rename it.
    /// When `None`, the archive is extracted directly with its natural names.
    pub fn sftp_extract(
        &self,
        session_id: &str,
        remote_archive: &str,
        remote_parent: &str,
        out_name: Option<&str>,
    ) -> AppResult<()> {
        let out_name = match out_name {
            None => {
                let cmd = extract_cmd(remote_archive, remote_parent)?;
                return self.exec_checked(session_id, &cmd).map(|_| ());
            }
            Some(n) => n,
        };

        let staging = join_remote(remote_parent, &format!(".mftp-x-{}", uuid_v4()));
        self.exec_checked(session_id, &format!("mkdir -p {}", shell_quote(&staging)))?;

        // Extract into the staging dir; clean up staging on any failure.
        let cmd = match extract_cmd(remote_archive, &staging) {
            Ok(c) => c,
            Err(e) => {
                let _ = self.exec(session_id, &format!("rm -rf {}", shell_quote(&staging)));
                return Err(e);
            }
        };
        if let Err(e) = self.exec_checked(session_id, &cmd) {
            let _ = self.exec(session_id, &format!("rm -rf {}", shell_quote(&staging)));
            return Err(e);
        }

        // Inspect the staging dir's top-level entries.
        let (_, listing, _) =
            self.exec(session_id, &format!("ls -1A {}", shell_quote(&staging)))?;
        let entries: Vec<&str> = listing.lines().filter(|l| !l.is_empty()).collect();
        let target = join_remote(remote_parent, out_name);

        let result = if entries.len() == 1 {
            // Single top entry: move it to the target name (unwrap/rename).
            let only = join_remote(&staging, entries[0]);
            self.exec_checked(
                session_id,
                &format!("mv {} {}", shell_quote(&only), shell_quote(&target)),
            )
            .map(|_| ())
        } else {
            // Multiple/zero entries: wrap the staging dir itself as the target.
            self.exec_checked(
                session_id,
                &format!("mv {} {}", shell_quote(&staging), shell_quote(&target)),
            )
            .map(|_| ())
        };

        // Remove staging if it still exists (it's gone when wrapped by mv).
        let _ = self.exec(session_id, &format!("rm -rf {}", shell_quote(&staging)));
        result
    }
}

/// Recursively delete a remote directory and all of its contents.
fn remove_dir_recursive(sftp: &ssh2::Sftp, dir: &Path) -> AppResult<()> {
    for (path, stat) in sftp.readdir(dir)? {
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if name == "." || name == ".." {
            continue;
        }
        if stat.is_dir() {
            remove_dir_recursive(sftp, &path)?;
        } else {
            sftp.unlink(&path)?;
        }
    }
    sftp.rmdir(dir)?;
    Ok(())
}

/// Generate a fresh UUID v4 string (short helper for temp file names).
fn uuid_v4() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Quote an argument for a POSIX shell by wrapping in single quotes.
fn shell_quote(s: &str) -> String {
    // Close the quote, insert an escaped single quote, reopen: ' -> '\''
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// Join a remote parent dir and a name with a single "/".
fn join_remote(parent: &str, name: &str) -> String {
    if parent.ends_with('/') {
        format!("{parent}{name}")
    } else {
        format!("{parent}/{name}")
    }
}

/// The parent directory of a remote path (POSIX, "/" separators).
fn remote_parent_of(path: &str) -> String {
    let trimmed = path.trim_end_matches('/');
    match trimmed.rfind('/') {
        Some(0) | None => "/".to_string(),
        Some(idx) => trimmed[..idx].to_string(),
    }
}

/// The final component of a remote path.
fn remote_basename(path: &str) -> String {
    let trimmed = path.trim_end_matches('/');
    match trimmed.rfind('/') {
        Some(idx) => trimmed[idx + 1..].to_string(),
        None => trimmed.to_string(),
    }
}

fn exec_on_session(sess: &Session, cmd: &str) -> AppResult<(i32, String, String)> {
    sess.set_blocking(true);
    sess.set_timeout(0);
    let mut channel = sess.channel_session()?;
    channel.exec(cmd)?;
    let mut stdout = String::new();
    channel.read_to_string(&mut stdout)?;
    let mut stderr = String::new();
    channel.stderr().read_to_string(&mut stderr)?;
    channel.wait_close()?;
    let code = channel.exit_status()?;
    Ok((code, stdout, stderr))
}

fn read_remote_text_and_remove(sess: &Session, path: &str) -> AppResult<String> {
    let cmd = format!("cat {}; rm -f {}", shell_quote(path), shell_quote(path));
    let (_, stdout, _) = exec_on_session(sess, &cmd)?;
    Ok(stdout)
}

fn remove_remote_file(sess: &Session, path: &str) -> AppResult<()> {
    let cmd = format!("rm -f {}", shell_quote(path));
    exec_on_session(sess, &cmd).map(|_| ())
}

/// Build the shell command to extract `archive` into `dest_dir`, choosing the
/// tool by file extension.
fn extract_cmd(archive: &str, dest_dir: &str) -> AppResult<String> {
    let lower = archive.to_lowercase();
    let a = shell_quote(archive);
    let d = shell_quote(dest_dir);
    if lower.ends_with(".zip") {
        Ok(format!("unzip -o {a} -d {d}"))
    } else if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
        Ok(format!("tar -xzf {a} -C {d}"))
    } else if lower.ends_with(".tar.bz2") || lower.ends_with(".tbz2") {
        Ok(format!("tar -xjf {a} -C {d}"))
    } else if lower.ends_with(".tar") {
        Ok(format!("tar -xf {a} -C {d}"))
    } else {
        Err(AppError("不支持的压缩包格式".into()))
    }
}

/// Pack `local_dir` into `dest` (tar.gz) with `top_name` as the archive's
/// top-level directory. `append_dir_all` includes empty directories.
fn pack_tar_gz(local_dir: &str, top_name: &str, dest: &Path) -> AppResult<()> {
    use flate2::write::GzEncoder;
    use flate2::Compression;
    let file = std::fs::File::create(dest)?;
    let enc = GzEncoder::new(file, Compression::default());
    let mut builder = tar::Builder::new(enc);
    builder
        .append_dir_all(top_name, local_dir)
        .map_err(|e| AppError(format!("打包失败: {e}")))?;
    let enc = builder
        .into_inner()
        .map_err(|e| AppError(format!("打包失败: {e}")))?;
    enc.finish()
        .map_err(|e| AppError(format!("打包失败: {e}")))?;
    Ok(())
}

/// Runs on a dedicated thread; owns the session + shell channel exclusively.
/// Blocking reads with a short timeout let us interleave write/resize jobs.
fn shell_worker(
    app: AppHandle,
    session_id: String,
    sess: Session,
    mut channel: ssh2::Channel,
    rx: Receiver<ShellJob>,
) {
    let data_event = format!("ssh://data/{session_id}");
    let closed_event = format!("ssh://closed/{session_id}");
    let mut buf = [0u8; 32 * 1024];

    loop {
        // Drain any pending control jobs first (writes/resize/close).
        let mut closed = false;
        loop {
            match rx.try_recv() {
                Ok(ShellJob::Write(data)) => {
                    if channel.write_all(&data).is_err() {
                        closed = true;
                        break;
                    }
                    let _ = channel.flush();
                }
                Ok(ShellJob::Resize(cols, rows)) => {
                    let _ = channel.request_pty_size(cols, rows, None, None);
                }
                Ok(ShellJob::Close) => {
                    closed = true;
                    break;
                }
                Err(std::sync::mpsc::TryRecvError::Empty) => break,
                Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                    closed = true;
                    break;
                }
            }
        }
        if closed {
            break;
        }

        // Poll for output with a short blocking timeout.
        sess.set_timeout(30);
        match channel.read(&mut buf) {
            Ok(0) => {
                if channel.eof() {
                    break;
                }
            }
            Ok(n) => {
                let encoded = STANDARD.encode(&buf[..n]);
                let _ = app.emit(&data_event, encoded);
            }
            Err(e) => {
                let kind = e.kind();
                if kind == std::io::ErrorKind::WouldBlock || kind == std::io::ErrorKind::TimedOut {
                    // No data within the poll window; keep going.
                } else {
                    break;
                }
            }
        }
        if channel.eof() {
            break;
        }
    }

    let _ = channel.close();
    let _ = channel.wait_close();
    let _ = app.emit(&closed_event, &session_id);
    let _ = sess; // keep session alive until channel is torn down
}

impl Manager {
    pub fn shutdown_all(&self) {
        let ids: Vec<String> = self.shells.lock().keys().cloned().collect();
        for id in ids {
            self.disconnect(&id);
        }
    }
}

/// Small helper used by commands to sleep between retries if needed.
#[allow(dead_code)]
pub fn brief_pause() {
    std::thread::sleep(Duration::from_millis(10));
}
