use crate::error::{AppError, AppResult};
use crate::models::{SftpEntry, TransferProgress};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use parking_lot::Mutex;
use ssh2::{ErrorCode, FileStat, OpenFlags, OpenType, RenameFlags, Session};
use std::collections::HashMap;
use std::env;
use std::fs::{self, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{Receiver, Sender};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;

const SFTP_KEEPALIVE_INTERVAL_SECS: u32 = 15;
const SFTP_TRANSFER_RETRIES: usize = 3;
const SFTP_TRANSFER_BUFFER_SIZE: usize = 256 * 1024;
const SFTP_TRANSFER_KEEPALIVE_SECS: u64 = 5;
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
    let tcp = connect_tcp(&mat.host, mat.port)?;
    let mut sess = Session::new()?;
    sess.set_tcp_stream(tcp);
    sess.handshake()?;
    match &mat.method {
        AuthMethod::Password(Some(pw)) => {
            sess.userauth_password(&mat.username, pw)?;
        }
        AuthMethod::Password(None) => authenticate_with_local_defaults(&sess, mat)?,
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

fn authenticate_with_local_defaults(sess: &Session, mat: &AuthMaterial) -> AppResult<()> {
    let mut errors = Vec::new();

    match sess.userauth_agent(&mat.username) {
        Ok(()) if sess.authenticated() => return Ok(()),
        Ok(()) => {}
        Err(e) => errors.push(format!("agent: {e}")),
    }

    for path in local_identity_candidates(&mat.identity_files) {
        if !path.exists() {
            continue;
        }
        match sess.userauth_pubkey_file(&mat.username, None, &path, None) {
            Ok(()) if sess.authenticated() => return Ok(()),
            Ok(()) => {}
            Err(e) => errors.push(format!("{}: {e}", path.display())),
        }
    }

    let detail = if errors.is_empty() {
        "未找到可用的 ssh-agent 或默认私钥".to_string()
    } else {
        errors.join("; ")
    };
    Err(AppError(format!(
        "authentication failed for {}@{}:{} ({detail})",
        mat.username, mat.host, mat.port
    )))
}

fn connect_tcp(host: &str, port: u16) -> AppResult<TcpStream> {
    let host = host.trim();
    let mut addrs: Vec<SocketAddr> = (host, port)
        .to_socket_addrs()
        .map_err(|e| AppError(format!("resolve {host}:{port} failed: {e}")))?
        .collect();

    if addrs.is_empty() {
        return Err(AppError(format!(
            "resolve {host}:{port} failed: no addresses"
        )));
    }

    if host.eq_ignore_ascii_case("localhost") {
        addrs.sort_by_key(|addr| if addr.is_ipv4() { 0 } else { 1 });
    }

    let mut errors = Vec::new();
    for addr in addrs {
        match TcpStream::connect(addr) {
            Ok(tcp) => {
                let _ = tcp.set_nodelay(true);
                return Ok(tcp);
            }
            Err(e) => errors.push(format!("{addr}: {e}")),
        }
    }

    let hint = if host.eq_ignore_ascii_case("localhost") {
        "；如果命令行依赖 ProxyCommand/ProxyJump，当前内置连接暂不支持该跳板配置"
    } else {
        ""
    };
    Err(AppError(format!(
        "connect {host}:{port} failed: {}{hint}",
        errors.join("; ")
    )))
}

#[derive(Default)]
struct SshHostConfig {
    hostname: Option<String>,
    port: Option<u16>,
    user: Option<String>,
    identity_files: Vec<PathBuf>,
}

pub fn resolve_auth_material(mut mat: AuthMaterial) -> AppResult<AuthMaterial> {
    let original_host = mat.host.clone();
    if let Some(config) = read_ssh_config_for_host(&original_host) {
        if mat.username.trim().is_empty() {
            if let Some(user) = config.user {
                mat.username = expand_ssh_tokens(&user, &original_host, "");
            }
        }
        if let Some(hostname) = config.hostname {
            mat.host = expand_ssh_tokens(&hostname, &original_host, &mat.username);
        }
        if let Some(port) = config.port {
            mat.port = port;
        }
        mat.identity_files = config.identity_files;
    }

    if mat.username.trim().is_empty() {
        mat.username = local_username()?;
    }

    Ok(mat)
}

fn read_ssh_config_for_host(host: &str) -> Option<SshHostConfig> {
    let path = dirs::home_dir()?.join(".ssh/config");
    let raw = fs::read_to_string(path).ok()?;
    let mut config = SshHostConfig::default();
    let mut active = true;

    for raw_line in raw.lines() {
        let Some((key, value)) = parse_ssh_config_line(raw_line) else {
            continue;
        };
        let key = key.to_ascii_lowercase();
        if key == "host" {
            active = host_patterns_match(&value, host);
            continue;
        }
        if !active {
            continue;
        }

        match key.as_str() {
            "hostname" if config.hostname.is_none() => {
                config.hostname = Some(value);
            }
            "port" if config.port.is_none() => {
                config.port = value.parse::<u16>().ok();
            }
            "user" if config.user.is_none() => {
                config.user = Some(value);
            }
            "identityfile" => {
                let user = config.user.as_deref().unwrap_or("");
                config
                    .identity_files
                    .push(expand_identity_path(&value, host, user));
            }
            _ => {}
        }
    }

    Some(config)
}

fn parse_ssh_config_line(line: &str) -> Option<(String, String)> {
    let line = strip_ssh_comment(line).trim();
    if line.is_empty() {
        return None;
    }

    let first_ws = line.find(char::is_whitespace);
    let first_eq = line.find('=');
    let (key, value) = match (first_eq, first_ws) {
        (Some(eq), Some(ws)) if eq < ws => (&line[..eq], &line[eq + 1..]),
        (Some(eq), None) => (&line[..eq], &line[eq + 1..]),
        (_, Some(ws)) => (&line[..ws], &line[ws + 1..]),
        _ => return None,
    };

    Some((key.trim().to_string(), unquote_ssh_value(value.trim())))
}

fn strip_ssh_comment(line: &str) -> &str {
    let mut single = false;
    let mut double = false;
    for (idx, ch) in line.char_indices() {
        match ch {
            '\'' if !double => single = !single,
            '"' if !single => double = !double,
            '#' if !single && !double => return &line[..idx],
            _ => {}
        }
    }
    line
}

fn unquote_ssh_value(value: &str) -> String {
    if value.len() >= 2 {
        let bytes = value.as_bytes();
        if (bytes[0] == b'"' && bytes[value.len() - 1] == b'"')
            || (bytes[0] == b'\'' && bytes[value.len() - 1] == b'\'')
        {
            return value[1..value.len() - 1].to_string();
        }
    }
    value.to_string()
}

fn host_patterns_match(patterns: &str, host: &str) -> bool {
    let mut matched = false;
    for pattern in patterns.split_whitespace() {
        if let Some(negated) = pattern.strip_prefix('!') {
            if wildcard_match(negated, host) {
                return false;
            }
        } else if wildcard_match(pattern, host) {
            matched = true;
        }
    }
    matched
}

fn wildcard_match(pattern: &str, text: &str) -> bool {
    let pattern = pattern.to_ascii_lowercase();
    let text = text.to_ascii_lowercase();
    wildcard_match_bytes(pattern.as_bytes(), text.as_bytes())
}

fn wildcard_match_bytes(pattern: &[u8], text: &[u8]) -> bool {
    if pattern.is_empty() {
        return text.is_empty();
    }

    match pattern[0] {
        b'*' => {
            wildcard_match_bytes(&pattern[1..], text)
                || (!text.is_empty() && wildcard_match_bytes(pattern, &text[1..]))
        }
        b'?' => !text.is_empty() && wildcard_match_bytes(&pattern[1..], &text[1..]),
        ch => !text.is_empty() && ch == text[0] && wildcard_match_bytes(&pattern[1..], &text[1..]),
    }
}

fn expand_identity_path(value: &str, host: &str, user: &str) -> PathBuf {
    let expanded = expand_ssh_tokens(value, host, user);
    if let Some(home) = dirs::home_dir() {
        if expanded == "~" {
            return home;
        }
        if let Some(rest) = expanded.strip_prefix("~/") {
            return home.join(rest);
        }
    }
    PathBuf::from(expanded)
}

fn expand_ssh_tokens(value: &str, host: &str, user: &str) -> String {
    let local_user = local_username().unwrap_or_else(|_| String::new());
    let home = dirs::home_dir()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default();
    value
        .replace("%h", host)
        .replace("%n", host)
        .replace("%r", user)
        .replace("%u", &local_user)
        .replace("%d", &home)
}

fn local_username() -> AppResult<String> {
    env::var("USER")
        .or_else(|_| env::var("USERNAME"))
        .map_err(|_| AppError("无法获取本机用户名，请在主机配置中填写用户名".into()))
}

fn local_identity_candidates(configured: &[PathBuf]) -> Vec<PathBuf> {
    let mut paths = configured.to_vec();
    if let Some(home) = dirs::home_dir() {
        let ssh_dir = home.join(".ssh");
        for name in [
            "id_ed25519",
            "id_ecdsa",
            "id_ecdsa_sk",
            "id_ed25519_sk",
            "id_rsa",
            "id_dsa",
        ] {
            let path = ssh_dir.join(name);
            if !paths.iter().any(|item| item == &path) {
                paths.push(path);
            }
        }
    }
    paths
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
        || msg.contains("session(-7)")
        || msg.contains("session(-9)")
        || msg.contains("session(-13)")
        || msg.contains("session(-30)")
        || msg.contains("session(-43)")
        || msg.contains("session(-45)")
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

enum UploadEntryKind {
    Directory,
    File { size: u64 },
    Symlink { target: String },
}

struct UploadEntry {
    local: PathBuf,
    remote: String,
    kind: UploadEntryKind,
}

struct UploadPlan {
    entries: Vec<UploadEntry>,
    total_file_bytes: u64,
}

enum DownloadEntryKind {
    Directory,
    File { size: u64 },
    Symlink { target: String },
}

struct DownloadEntry {
    remote: String,
    local: PathBuf,
    kind: DownloadEntryKind,
}

struct DownloadPlan {
    entries: Vec<DownloadEntry>,
    total_file_bytes: u64,
}

fn build_upload_plan(local_dir: &str, remote_root: &str) -> AppResult<UploadPlan> {
    let root = Path::new(local_dir);
    if !root.is_dir() {
        return Err(AppError("本地路径不是文件夹".into()));
    }

    let mut entries = Vec::new();
    let mut total_file_bytes = 0u64;
    for entry in WalkDir::new(root).follow_links(false).into_iter() {
        let entry = entry.map_err(|e| AppError(format!("扫描失败: {e}")))?;
        let local = entry.path().to_path_buf();
        let relative = local.strip_prefix(root).unwrap_or(Path::new(""));
        let remote = remote_path_for_relative(remote_root, relative);
        let file_type = entry.file_type();

        let kind = if file_type.is_dir() {
            UploadEntryKind::Directory
        } else if file_type.is_file() {
            let size = std::fs::symlink_metadata(&local)?.len();
            total_file_bytes = total_file_bytes.saturating_add(size);
            UploadEntryKind::File { size }
        } else if file_type.is_symlink() {
            let target = std::fs::read_link(&local)?.to_string_lossy().to_string();
            UploadEntryKind::Symlink { target }
        } else {
            return Err(AppError(format!("不支持上传特殊文件: {}", local.display())));
        };

        entries.push(UploadEntry {
            local,
            remote,
            kind,
        });
    }

    Ok(UploadPlan {
        entries,
        total_file_bytes,
    })
}

fn remote_path_for_relative(remote_root: &str, relative: &Path) -> String {
    if relative.as_os_str().is_empty() {
        return remote_root.to_string();
    }

    let mut remote = remote_root.to_string();
    for part in relative {
        remote = join_remote(&remote, &part.to_string_lossy());
    }
    remote
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

    pub fn sftp_delete(
        &self,
        session_id: &str,
        path: &str,
        is_dir: bool,
        app: Option<&AppHandle>,
        transfer_id: Option<&str>,
    ) -> AppResult<()> {
        if is_protected_remote_path(path) {
            return Err(AppError("拒绝删除根目录或空路径".into()));
        }

        if is_dir {
            emit_transfer_progress(app, transfer_id, "远端删除中", 0, None);
            self.exec_checked(session_id, &format!("rm -rf -- {}", shell_quote(path)))?;
            emit_transfer_progress(app, transfer_id, "完成", 1, Some(1));
            return Ok(());
        }

        let conn = self.sftp_conn(session_id)?;
        let conn = conn.lock();
        conn.sftp.unlink(Path::new(path))?;
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
        let mut buf = [0u8; SFTP_TRANSFER_BUFFER_SIZE];
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
                let mut last_keepalive = Instant::now();
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
                    if last_keepalive.elapsed() >= Duration::from_secs(SFTP_TRANSFER_KEEPALIVE_SECS)
                    {
                        let _ = conn_guard.session.keepalive_send();
                        last_keepalive = Instant::now();
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
        let total = std::fs::metadata(local)?.len();
        let temp_remote = remote_temp_sibling(remote);
        emit_transfer_progress(app, transfer_id, "上传中", 0, Some(total));
        let upload_res = self.upload_local_file_to_remote(
            session_id,
            Path::new(local),
            &temp_remote,
            app,
            transfer_id,
            "上传中",
            0,
            total,
            transfer.as_ref(),
        );
        if let Err(e) = upload_res {
            let _ = self.remove_remote_path_if_file(session_id, &temp_remote);
            return Err(e);
        }
        if let Some(transfer) = &transfer {
            if let Err(e) = transfer.check() {
                let _ = self.remove_remote_path_if_file(session_id, &temp_remote);
                return Err(e);
            }
        }
        if let Err(e) = self.sftp_rename_overwrite(session_id, &temp_remote, remote) {
            let _ = self.remove_remote_path_if_file(session_id, &temp_remote);
            return Err(e);
        }
        emit_transfer_progress(app, transfer_id, "完成", total, Some(total));
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

    fn remove_remote_path_if_file(&self, session_id: &str, path: &str) -> AppResult<()> {
        let conn = self.sftp_conn(session_id)?;
        let conn = conn.lock();
        match conn.sftp.unlink(Path::new(path)) {
            Ok(()) => Ok(()),
            Err(e) if stale_session_error(&e) => Err(e.into()),
            Err(_) => Ok(()),
        }
    }

    fn sftp_remote_file_size(&self, session_id: &str, path: &str) -> AppResult<Option<u64>> {
        let mut attempts = 0usize;
        loop {
            let conn = self.sftp_conn(session_id)?;
            let result = {
                let conn_guard = conn.lock();
                conn_guard.sftp.stat(Path::new(path))
            };
            match result {
                Ok(stat) => return Ok(stat.size),
                Err(e) if stale_session_error(&e) && attempts < SFTP_TRANSFER_RETRIES => {
                    attempts += 1;
                    self.remove_sftp_conn_if_current(session_id, &conn);
                    std::thread::sleep(Duration::from_millis(250));
                }
                Err(e) if stale_session_error(&e) => return Err(e.into()),
                Err(_) => return Ok(None),
            }
        }
    }

    fn sftp_mkdir_existing_ok(&self, session_id: &str, path: &str) -> AppResult<()> {
        let mut attempts = 0usize;
        loop {
            let conn = self.sftp_conn(session_id)?;
            let result: Result<(), ssh2::Error> = {
                let conn_guard = conn.lock();
                if conn_guard
                    .sftp
                    .stat(Path::new(path))
                    .is_ok_and(|stat| stat.is_dir())
                {
                    return Ok(());
                }
                conn_guard.sftp.mkdir(Path::new(path), 0o755)
            };
            match result {
                Ok(()) => return Ok(()),
                Err(e) if stale_session_error(&e) && attempts < SFTP_TRANSFER_RETRIES => {
                    attempts += 1;
                    self.remove_sftp_conn_if_current(session_id, &conn);
                    std::thread::sleep(Duration::from_millis(250));
                }
                Err(e) if stale_session_error(&e) => return Err(e.into()),
                Err(e) => {
                    let conn = self.sftp_conn(session_id)?;
                    let conn_guard = conn.lock();
                    if conn_guard
                        .sftp
                        .stat(Path::new(path))
                        .is_ok_and(|stat| stat.is_dir())
                    {
                        return Ok(());
                    }
                    return Err(e.into());
                }
            }
        }
    }

    fn sftp_rename_overwrite(&self, session_id: &str, from: &str, to: &str) -> AppResult<()> {
        let mut attempts = 0usize;
        loop {
            let conn = self.sftp_conn(session_id)?;
            let result = {
                let conn_guard = conn.lock();
                conn_guard.sftp.rename(
                    Path::new(from),
                    Path::new(to),
                    Some(RenameFlags::ATOMIC | RenameFlags::OVERWRITE | RenameFlags::NATIVE),
                )
            };
            match result {
                Ok(()) => return Ok(()),
                Err(e) if stale_session_error(&e) && attempts < SFTP_TRANSFER_RETRIES => {
                    attempts += 1;
                    self.remove_sftp_conn_if_current(session_id, &conn);
                    std::thread::sleep(Duration::from_millis(250));
                }
                Err(e) => return Err(e.into()),
            }
        }
    }

    fn sftp_symlink_overwrite(&self, session_id: &str, target: &str, link: &str) -> AppResult<()> {
        let mut attempts = 0usize;
        loop {
            let conn = self.sftp_conn(session_id)?;
            let result = {
                let conn_guard = conn.lock();
                let _ = conn_guard.sftp.unlink(Path::new(link));
                conn_guard.sftp.symlink(Path::new(target), Path::new(link))
            };
            match result {
                Ok(()) => return Ok(()),
                Err(e) if stale_session_error(&e) && attempts < SFTP_TRANSFER_RETRIES => {
                    attempts += 1;
                    self.remove_sftp_conn_if_current(session_id, &conn);
                    std::thread::sleep(Duration::from_millis(250));
                }
                Err(e) => return Err(e.into()),
            }
        }
    }

    fn sftp_lstat_retry(&self, session_id: &str, path: &str) -> AppResult<FileStat> {
        let mut attempts = 0usize;
        loop {
            let conn = self.sftp_conn(session_id)?;
            let result = {
                let conn_guard = conn.lock();
                conn_guard.sftp.lstat(Path::new(path))
            };
            match result {
                Ok(stat) => return Ok(stat),
                Err(e) if stale_session_error(&e) && attempts < SFTP_TRANSFER_RETRIES => {
                    attempts += 1;
                    self.remove_sftp_conn_if_current(session_id, &conn);
                    std::thread::sleep(Duration::from_millis(250));
                }
                Err(e) => return Err(e.into()),
            }
        }
    }

    fn sftp_readdir_retry(
        &self,
        session_id: &str,
        path: &str,
    ) -> AppResult<Vec<(PathBuf, FileStat)>> {
        let mut attempts = 0usize;
        loop {
            let conn = self.sftp_conn(session_id)?;
            let result = {
                let conn_guard = conn.lock();
                conn_guard.sftp.readdir(Path::new(path))
            };
            match result {
                Ok(entries) => return Ok(entries),
                Err(e) if stale_session_error(&e) && attempts < SFTP_TRANSFER_RETRIES => {
                    attempts += 1;
                    self.remove_sftp_conn_if_current(session_id, &conn);
                    std::thread::sleep(Duration::from_millis(250));
                }
                Err(e) => return Err(e.into()),
            }
        }
    }

    fn sftp_readlink_retry(&self, session_id: &str, path: &str) -> AppResult<String> {
        let mut attempts = 0usize;
        loop {
            let conn = self.sftp_conn(session_id)?;
            let result = {
                let conn_guard = conn.lock();
                conn_guard.sftp.readlink(Path::new(path))
            };
            match result {
                Ok(target) => return Ok(target.to_string_lossy().to_string()),
                Err(e) if stale_session_error(&e) && attempts < SFTP_TRANSFER_RETRIES => {
                    attempts += 1;
                    self.remove_sftp_conn_if_current(session_id, &conn);
                    std::thread::sleep(Duration::from_millis(250));
                }
                Err(e) => return Err(e.into()),
            }
        }
    }

    fn build_download_plan(
        &self,
        session_id: &str,
        remote_dir: &str,
        local_dir: &str,
    ) -> AppResult<DownloadPlan> {
        let mut plan = DownloadPlan {
            entries: Vec::new(),
            total_file_bytes: 0,
        };
        self.collect_download_entry(
            session_id,
            remote_dir,
            Path::new(local_dir).to_path_buf(),
            &mut plan,
        )?;
        Ok(plan)
    }

    fn collect_download_entry(
        &self,
        session_id: &str,
        remote: &str,
        local: PathBuf,
        plan: &mut DownloadPlan,
    ) -> AppResult<()> {
        let stat = self.sftp_lstat_retry(session_id, remote)?;
        if stat.is_dir() {
            plan.entries.push(DownloadEntry {
                remote: remote.to_string(),
                local: local.clone(),
                kind: DownloadEntryKind::Directory,
            });
            for (path, _) in self.sftp_readdir_retry(session_id, remote)? {
                let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
                    continue;
                };
                if name.is_empty() || name == "." || name == ".." {
                    continue;
                }
                self.collect_download_entry(
                    session_id,
                    &join_remote(remote, name),
                    local.join(name),
                    plan,
                )?;
            }
        } else if stat.file_type().is_symlink() {
            let target = self.sftp_readlink_retry(session_id, remote)?;
            plan.entries.push(DownloadEntry {
                remote: remote.to_string(),
                local,
                kind: DownloadEntryKind::Symlink { target },
            });
        } else if stat.is_file() {
            let size = stat.size.unwrap_or(0);
            plan.total_file_bytes = plan.total_file_bytes.saturating_add(size);
            plan.entries.push(DownloadEntry {
                remote: remote.to_string(),
                local,
                kind: DownloadEntryKind::File { size },
            });
        } else {
            return Err(AppError(format!("不支持下载特殊文件: {remote}")));
        }
        Ok(())
    }

    fn upload_local_file_to_remote(
        &self,
        session_id: &str,
        local: &Path,
        remote: &str,
        app: Option<&AppHandle>,
        transfer_id: Option<&str>,
        phase: &str,
        completed_before: u64,
        total: u64,
        transfer: Option<&TransferGuard>,
    ) -> AppResult<()> {
        let file_size = std::fs::metadata(local)?.len();
        let total = Some(total);
        let mut file_transferred = self
            .sftp_remote_file_size(session_id, remote)
            .unwrap_or(None)
            .unwrap_or(0)
            .min(file_size);
        let mut last_emit = Instant::now();
        let mut attempts = 0usize;

        loop {
            if let Some(transfer) = &transfer {
                transfer.check()?;
            }

            let conn = self.sftp_conn(session_id)?;
            let result: AppResult<()> = {
                let conn_guard = conn.lock();
                if file_transferred > 0 {
                    file_transferred = conn_guard
                        .sftp
                        .stat(Path::new(remote))
                        .ok()
                        .and_then(|stat| stat.size)
                        .unwrap_or(0)
                        .min(file_size);
                }
                let mut remote_file = if file_transferred == 0 {
                    conn_guard.sftp.create(Path::new(remote))?
                } else {
                    conn_guard.sftp.open_mode(
                        Path::new(remote),
                        OpenFlags::WRITE,
                        0o644,
                        OpenType::File,
                    )?
                };
                let mut local_file = std::fs::File::open(local)?;
                let mut buf = [0u8; SFTP_TRANSFER_BUFFER_SIZE];
                let mut last_keepalive = Instant::now();

                if file_transferred > 0 {
                    remote_file.seek(SeekFrom::Start(file_transferred))?;
                    local_file.seek(SeekFrom::Start(file_transferred))?;
                }

                emit_transfer_progress(
                    app,
                    transfer_id,
                    phase,
                    completed_before + file_transferred,
                    total,
                );
                loop {
                    if let Some(transfer) = &transfer {
                        transfer.check()?;
                    }
                    let n = local_file.read(&mut buf)?;
                    if n == 0 {
                        break;
                    }
                    remote_file.write_all(&buf[..n])?;
                    file_transferred += n as u64;
                    if last_emit.elapsed() >= Duration::from_millis(120) {
                        emit_transfer_progress(
                            app,
                            transfer_id,
                            phase,
                            completed_before + file_transferred,
                            total,
                        );
                        last_emit = Instant::now();
                    }
                    if last_keepalive.elapsed() >= Duration::from_secs(SFTP_TRANSFER_KEEPALIVE_SECS)
                    {
                        let _ = conn_guard.session.keepalive_send();
                        last_keepalive = Instant::now();
                    }
                }
                remote_file.flush()?;
                Ok(())
            };

            match result {
                Ok(()) => break,
                Err(e) if attempts < SFTP_TRANSFER_RETRIES && stale_app_error(&e) => {
                    attempts += 1;
                    self.remove_sftp_conn_if_current(session_id, &conn);
                    emit_transfer_progress(
                        app,
                        transfer_id,
                        "重连后继续上传",
                        completed_before + file_transferred,
                        total,
                    );
                    std::thread::sleep(Duration::from_millis(250));
                }
                Err(e) => return Err(e),
            }
        }

        let actual_size = self
            .sftp_remote_file_size(session_id, remote)?
            .ok_or_else(|| AppError(format!("上传校验失败：远端临时文件不存在: {}", remote)))?;
        if actual_size != file_size {
            return Err(AppError(format!(
                "上传校验失败：远端文件大小为 {actual_size} 字节，本地文件大小为 {file_size} 字节"
            )));
        }
        emit_transfer_progress(app, transfer_id, phase, completed_before + file_size, total);
        Ok(())
    }

    /// Upload a local directory recursively over SFTP.
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
        emit_transfer_progress(app, transfer_id, "扫描中", 0, None);
        if let Some(transfer) = &transfer {
            transfer.check()?;
        }
        let remote_root = join_remote(remote_parent, remote_name);
        let plan = build_upload_plan(local_dir, &remote_root)?;
        if let Some(transfer) = &transfer {
            transfer.check()?;
        }

        let total = plan.total_file_bytes;
        let total_for_progress = if total == 0 { Some(1) } else { Some(total) };
        let mut uploaded = 0u64;
        emit_transfer_progress(app, transfer_id, "创建目录中", 0, total_for_progress);

        for entry in plan.entries {
            if let Some(transfer) = &transfer {
                transfer.check()?;
            }

            match entry.kind {
                UploadEntryKind::Directory => {
                    self.sftp_mkdir_existing_ok(session_id, &entry.remote)?;
                    emit_transfer_progress(
                        app,
                        transfer_id,
                        "上传文件夹中",
                        uploaded,
                        total_for_progress,
                    );
                }
                UploadEntryKind::File { size } => {
                    self.sftp_mkdir_existing_ok(session_id, &remote_parent_of(&entry.remote))?;
                    let temp_remote = remote_temp_sibling(&entry.remote);
                    let upload_res = self.upload_local_file_to_remote(
                        session_id,
                        &entry.local,
                        &temp_remote,
                        app,
                        transfer_id,
                        "上传文件夹中",
                        uploaded,
                        total,
                        transfer.as_ref(),
                    );
                    if let Err(e) = upload_res {
                        let _ = self.remove_remote_path_if_file(session_id, &temp_remote);
                        return Err(e);
                    }
                    if let Err(e) =
                        self.sftp_rename_overwrite(session_id, &temp_remote, &entry.remote)
                    {
                        let _ = self.remove_remote_path_if_file(session_id, &temp_remote);
                        return Err(e);
                    }
                    uploaded = uploaded.saturating_add(size);
                    emit_transfer_progress(
                        app,
                        transfer_id,
                        "上传文件夹中",
                        uploaded,
                        total_for_progress,
                    );
                }
                UploadEntryKind::Symlink { target } => {
                    self.sftp_symlink_overwrite(session_id, &target, &entry.remote)?;
                    emit_transfer_progress(
                        app,
                        transfer_id,
                        "上传文件夹中",
                        uploaded,
                        total_for_progress,
                    );
                }
            }
        }

        emit_transfer_progress(
            app,
            transfer_id,
            "完成",
            total_for_progress.unwrap_or(1),
            total_for_progress,
        );
        Ok(())
    }

    fn download_remote_file_to_local(
        &self,
        session_id: &str,
        remote: &str,
        local: &Path,
        expected_size: u64,
        app: Option<&AppHandle>,
        transfer_id: Option<&str>,
        phase: &str,
        completed_before: u64,
        total: u64,
        transfer: Option<&TransferGuard>,
    ) -> AppResult<()> {
        let total = Some(total);
        let mut file_transferred = std::fs::metadata(local)
            .ok()
            .map(|meta| meta.len())
            .unwrap_or(0)
            .min(expected_size);
        let mut last_emit = Instant::now();
        let mut attempts = 0usize;

        loop {
            if let Some(transfer) = &transfer {
                transfer.check()?;
            }

            let conn = self.sftp_conn(session_id)?;
            let result: AppResult<()> = {
                let conn_guard = conn.lock();
                let mut remote_file = conn_guard.sftp.open(Path::new(remote))?;
                let mut local_file = OpenOptions::new().create(true).write(true).open(local)?;
                let mut buf = [0u8; SFTP_TRANSFER_BUFFER_SIZE];
                let mut last_keepalive = Instant::now();

                if file_transferred > 0 {
                    remote_file.seek(SeekFrom::Start(file_transferred))?;
                    local_file.seek(SeekFrom::Start(file_transferred))?;
                }

                emit_transfer_progress(
                    app,
                    transfer_id,
                    phase,
                    completed_before + file_transferred,
                    total,
                );
                loop {
                    if let Some(transfer) = &transfer {
                        transfer.check()?;
                    }
                    let n = remote_file.read(&mut buf)?;
                    if n == 0 {
                        break;
                    }
                    local_file.write_all(&buf[..n])?;
                    file_transferred += n as u64;
                    if last_emit.elapsed() >= Duration::from_millis(120) {
                        emit_transfer_progress(
                            app,
                            transfer_id,
                            phase,
                            completed_before + file_transferred,
                            total,
                        );
                        last_emit = Instant::now();
                    }
                    if last_keepalive.elapsed() >= Duration::from_secs(SFTP_TRANSFER_KEEPALIVE_SECS)
                    {
                        let _ = conn_guard.session.keepalive_send();
                        last_keepalive = Instant::now();
                    }
                }
                local_file.flush()?;
                Ok(())
            };

            match result {
                Ok(()) => break,
                Err(e) if attempts < SFTP_TRANSFER_RETRIES && stale_app_error(&e) => {
                    attempts += 1;
                    self.remove_sftp_conn_if_current(session_id, &conn);
                    emit_transfer_progress(
                        app,
                        transfer_id,
                        "重连后继续下载",
                        completed_before + file_transferred,
                        total,
                    );
                    std::thread::sleep(Duration::from_millis(250));
                }
                Err(e) => return Err(e),
            }
        }

        let actual_size = std::fs::metadata(local)?.len();
        if actual_size != expected_size {
            return Err(AppError(format!(
                "下载校验失败：本地文件大小为 {actual_size} 字节，远端文件大小为 {expected_size} 字节"
            )));
        }
        emit_transfer_progress(
            app,
            transfer_id,
            phase,
            completed_before + expected_size,
            total,
        );
        Ok(())
    }

    /// Download a remote directory recursively over SFTP.
    pub fn sftp_download_dir(
        &self,
        session_id: &str,
        remote_dir: &str,
        local_dir: &str,
        app: Option<&AppHandle>,
        transfer_id: Option<&str>,
    ) -> AppResult<()> {
        let transfer = self.transfer_guard(transfer_id);
        emit_transfer_progress(app, transfer_id, "扫描中", 0, None);
        if let Some(transfer) = &transfer {
            transfer.check()?;
        }
        let plan = self.build_download_plan(session_id, remote_dir, local_dir)?;
        if let Some(transfer) = &transfer {
            transfer.check()?;
        }

        let total = plan.total_file_bytes;
        let total_for_progress = if total == 0 { Some(1) } else { Some(total) };
        let mut downloaded = 0u64;
        emit_transfer_progress(app, transfer_id, "创建目录中", 0, total_for_progress);

        for entry in plan.entries {
            if let Some(transfer) = &transfer {
                transfer.check()?;
            }

            match entry.kind {
                DownloadEntryKind::Directory => {
                    std::fs::create_dir_all(&entry.local)?;
                    emit_transfer_progress(
                        app,
                        transfer_id,
                        "下载文件夹中",
                        downloaded,
                        total_for_progress,
                    );
                }
                DownloadEntryKind::File { size } => {
                    if let Some(parent) = entry.local.parent() {
                        std::fs::create_dir_all(parent)?;
                    }
                    let temp_local = local_temp_sibling(&entry.local);
                    let download_res = self.download_remote_file_to_local(
                        session_id,
                        &entry.remote,
                        &temp_local,
                        size,
                        app,
                        transfer_id,
                        "下载文件夹中",
                        downloaded,
                        total,
                        transfer.as_ref(),
                    );
                    if let Err(e) = download_res {
                        let _ = std::fs::remove_file(&temp_local);
                        return Err(e);
                    }
                    if let Err(e) = rename_local_file_overwrite(&temp_local, &entry.local) {
                        let _ = std::fs::remove_file(&temp_local);
                        return Err(e);
                    }
                    downloaded = downloaded.saturating_add(size);
                    emit_transfer_progress(
                        app,
                        transfer_id,
                        "下载文件夹中",
                        downloaded,
                        total_for_progress,
                    );
                }
                DownloadEntryKind::Symlink { target } => {
                    if let Some(parent) = entry.local.parent() {
                        std::fs::create_dir_all(parent)?;
                    }
                    create_local_symlink_overwrite(&target, &entry.local)?;
                    emit_transfer_progress(
                        app,
                        transfer_id,
                        "下载文件夹中",
                        downloaded,
                        total_for_progress,
                    );
                }
            }
        }

        emit_transfer_progress(
            app,
            transfer_id,
            "完成",
            total_for_progress.unwrap_or(1),
            total_for_progress,
        );
        Ok(())
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

/// Generate a fresh UUID v4 string (short helper for temp file names).
fn uuid_v4() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn is_protected_remote_path(path: &str) -> bool {
    let trimmed = path.trim();
    trimmed.is_empty() || trimmed == "/" || trimmed == "." || trimmed == ".."
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

fn remote_temp_sibling(path: &str) -> String {
    let parent = remote_parent_of(path);
    let name = remote_basename(path);
    join_remote(&parent, &format!(".{name}.mftp-part-{}", uuid_v4()))
}

fn local_temp_sibling(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy())
        .unwrap_or_else(|| "download".into());
    path.with_file_name(format!(".{name}.mftp-part-{}", uuid_v4()))
}

fn rename_local_file_overwrite(from: &Path, to: &Path) -> AppResult<()> {
    if to.is_dir() {
        return Err(AppError(format!(
            "本地目标已是文件夹，无法覆盖为文件: {}",
            to.display()
        )));
    }
    if to.exists() {
        std::fs::remove_file(to)?;
    }
    std::fs::rename(from, to)?;
    Ok(())
}

fn create_local_symlink_overwrite(target: &str, link: &Path) -> AppResult<()> {
    if link.is_dir() {
        return Err(AppError(format!(
            "本地目标已是文件夹，无法覆盖为符号链接: {}",
            link.display()
        )));
    }
    if link.exists() {
        std::fs::remove_file(link)?;
    }
    create_local_symlink(target, link)
}

#[cfg(unix)]
fn create_local_symlink(target: &str, link: &Path) -> AppResult<()> {
    std::os::unix::fs::symlink(target, link)?;
    Ok(())
}

#[cfg(windows)]
fn create_local_symlink(target: &str, link: &Path) -> AppResult<()> {
    std::os::windows::fs::symlink_file(target, link)?;
    Ok(())
}

#[cfg(not(any(unix, windows)))]
fn create_local_symlink(_target: &str, link: &Path) -> AppResult<()> {
    Err(AppError(format!(
        "当前平台不支持创建本地符号链接: {}",
        link.display()
    )))
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
