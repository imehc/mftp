use crate::error::{AppError, AppResult};
use crate::models::SftpEntry;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use parking_lot::Mutex;
use ssh2::Session;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{Receiver, Sender};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

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

#[derive(Default)]
pub struct Manager {
    auth: Mutex<HashMap<String, AuthMaterial>>,
    shells: Mutex<HashMap<String, ShellHandle>>,
    /// Lazily-created SFTP connections (one per session). Cached so that the
    /// SFTP subsystem is initialized only once, not on every operation.
    sftp: Mutex<HashMap<String, Arc<Mutex<SftpConn>>>>,
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
    Ok(sess)
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
        if self.shells.lock().contains_key(session_id) {
            return Ok(()); // already open
        }
        let mat = self.material(session_id)?;
        let sess = connect(&mat)?;

        let mut channel = sess.channel_session()?;
        channel.request_pty("xterm-256color", None, Some((cols, rows, 0, 0)))?;
        channel.shell()?;

        let (tx, rx) = std::sync::mpsc::channel::<ShellJob>();
        self.shells
            .lock()
            .insert(session_id.to_string(), ShellHandle { tx });

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

    /// Get (or lazily create) the SFTP connection for this session. The SFTP
    /// subsystem is initialized once here and reused for every subsequent call.
    fn sftp_conn(&self, session_id: &str) -> AppResult<Arc<Mutex<SftpConn>>> {
        if let Some(s) = self.sftp.lock().get(session_id) {
            return Ok(s.clone());
        }
        let mat = self.material(session_id)?;
        let sess = connect(&mat)?;
        let sftp = sess.sftp()?;
        let arc = Arc::new(Mutex::new(SftpConn {
            sftp,
            session: sess,
        }));
        self.sftp
            .lock()
            .insert(session_id.to_string(), arc.clone());
        Ok(arc)
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
        let conn = conn.lock();
        let base = Path::new(path);
        let mut entries = Vec::new();
        for (p, stat) in conn.sftp.readdir(base)? {
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
        Ok(entries)
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
    pub fn sftp_download(&self, session_id: &str, remote: &str, local: &str) -> AppResult<()> {
        let conn = self.sftp_conn(session_id)?;
        let conn = conn.lock();
        let mut remote_file = conn.sftp.open(Path::new(remote))?;
        let mut local_file = std::fs::File::create(local)?;
        let mut buf = [0u8; 32 * 1024];
        loop {
            let n = remote_file.read(&mut buf)?;
            if n == 0 {
                break;
            }
            local_file.write_all(&buf[..n])?;
        }
        Ok(())
    }

    /// Upload a local file to a remote path.
    pub fn sftp_upload(&self, session_id: &str, local: &str, remote: &str) -> AppResult<()> {
        let conn = self.sftp_conn(session_id)?;
        let conn = conn.lock();
        let mut local_file = std::fs::File::open(local)?;
        let mut remote_file = conn.sftp.create(Path::new(remote))?;
        let mut buf = [0u8; 32 * 1024];
        loop {
            let n = local_file.read(&mut buf)?;
            if n == 0 {
                break;
            }
            remote_file.write_all(&buf[..n])?;
        }
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
    ) -> AppResult<()> {
        // 1. Build a local tar.gz with `remote_name` as the top directory.
        let local_archive = std::env::temp_dir().join(format!("mftp-up-{}.tar.gz", uuid_v4()));
        pack_tar_gz(local_dir, remote_name, &local_archive)?;

        // 2. Upload it to a hidden temp file in the remote parent.
        let remote_archive = join_remote(remote_parent, &format!(".mftp-up-{}.tar.gz", uuid_v4()));
        let upload_res = self.sftp_upload(session_id, &local_archive.to_string_lossy(), &remote_archive);
        // Local temp no longer needed once uploaded (or on failure).
        let _ = std::fs::remove_file(&local_archive);
        upload_res?;

        // 3. Extract remotely, then remove the remote temp archive regardless.
        let cmd = format!(
            "tar -xzf {} -C {}",
            shell_quote(&remote_archive),
            shell_quote(remote_parent)
        );
        let extract_res = self.exec_checked(session_id, &cmd).map(|_| ());
        let _ = self.exec(session_id, &format!("rm -f {}", shell_quote(&remote_archive)));
        extract_res
    }

    /// Pack a remote directory into a tar.gz on the remote, then download it.
    pub fn sftp_download_dir(
        &self,
        session_id: &str,
        remote_dir: &str,
        local_archive: &str,
    ) -> AppResult<()> {
        let parent = remote_parent_of(remote_dir);
        let name = remote_basename(remote_dir);
        let remote_archive = format!("/tmp/mftp-dl-{}.tar.gz", uuid_v4());

        // 1. Pack remotely (top-level entry = the directory name).
        let cmd = format!(
            "tar -czf {} -C {} {}",
            shell_quote(&remote_archive),
            shell_quote(&parent),
            shell_quote(&name)
        );
        self.exec_checked(session_id, &cmd)?;

        // 2. Download, then remove the remote temp archive regardless.
        let dl = self.sftp_download(session_id, &remote_archive, local_archive);
        let _ = self.exec(session_id, &format!("rm -f {}", shell_quote(&remote_archive)));
        dl
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
    enc.finish().map_err(|e| AppError(format!("打包失败: {e}")))?;
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
                if kind == std::io::ErrorKind::WouldBlock
                    || kind == std::io::ErrorKind::TimedOut
                {
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
