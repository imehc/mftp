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

#[derive(Default)]
pub struct Manager {
    auth: Mutex<HashMap<String, AuthMaterial>>,
    shells: Mutex<HashMap<String, ShellHandle>>,
    /// Lazily-created SFTP sessions (one blocking session per connection).
    sftp: Mutex<HashMap<String, Arc<Mutex<Session>>>>,
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

    /// Get (or lazily create) the SFTP session for this connection.
    fn sftp_session(&self, session_id: &str) -> AppResult<Arc<Mutex<Session>>> {
        if let Some(s) = self.sftp.lock().get(session_id) {
            return Ok(s.clone());
        }
        let mat = self.material(session_id)?;
        let sess = connect(&mat)?;
        let arc = Arc::new(Mutex::new(sess));
        self.sftp
            .lock()
            .insert(session_id.to_string(), arc.clone());
        Ok(arc)
    }

    pub fn sftp_home(&self, session_id: &str) -> AppResult<String> {
        let sess = self.sftp_session(session_id)?;
        let sess = sess.lock();
        let sftp = sess.sftp()?;
        // realpath(".") resolves the login directory.
        let home = sftp.realpath(Path::new("."))?;
        Ok(home.to_string_lossy().to_string())
    }

    pub fn sftp_list(&self, session_id: &str, path: &str) -> AppResult<Vec<SftpEntry>> {
        let sess = self.sftp_session(session_id)?;
        let sess = sess.lock();
        let sftp = sess.sftp()?;
        let base = Path::new(path);
        let mut entries = Vec::new();
        for (p, stat) in sftp.readdir(base)? {
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
        let sess = self.sftp_session(session_id)?;
        let sess = sess.lock();
        let sftp = sess.sftp()?;
        sftp.mkdir(Path::new(path), 0o755)?;
        Ok(())
    }

    pub fn sftp_rename(&self, session_id: &str, from: &str, to: &str) -> AppResult<()> {
        let sess = self.sftp_session(session_id)?;
        let sess = sess.lock();
        let sftp = sess.sftp()?;
        sftp.rename(Path::new(from), Path::new(to), None)?;
        Ok(())
    }

    pub fn sftp_delete(&self, session_id: &str, path: &str, is_dir: bool) -> AppResult<()> {
        let sess = self.sftp_session(session_id)?;
        let sess = sess.lock();
        let sftp = sess.sftp()?;
        if is_dir {
            sftp.rmdir(Path::new(path))?;
        } else {
            sftp.unlink(Path::new(path))?;
        }
        Ok(())
    }

    /// Download a remote file to a local path.
    pub fn sftp_download(&self, session_id: &str, remote: &str, local: &str) -> AppResult<()> {
        let sess = self.sftp_session(session_id)?;
        let sess = sess.lock();
        let sftp = sess.sftp()?;
        let mut remote_file = sftp.open(Path::new(remote))?;
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
        let sess = self.sftp_session(session_id)?;
        let sess = sess.lock();
        let sftp = sess.sftp()?;
        let mut local_file = std::fs::File::open(local)?;
        let mut remote_file = sftp.create(Path::new(remote))?;
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
