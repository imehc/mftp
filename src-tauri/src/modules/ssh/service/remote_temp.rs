use super::auth::SSH_OPERATION_TIMEOUT_MS;
use super::types::{AuthMaterial, Manager, SftpConn};
use crate::error::AppResult;
use parking_lot::Mutex;
use ssh2::{OpenFlags, OpenType, Session};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

const CLEANUP_LOCK_TIMEOUT: Duration = Duration::from_millis(100);
const CLEANUP_IO_TIMEOUT_MS: u32 = 2_000;

struct Cleanup<F: FnOnce() -> AppResult<()>> {
    action: Option<F>,
    owned: bool,
}

impl<F: FnOnce() -> AppResult<()>> Drop for Cleanup<F> {
    fn drop(&mut self) {
        if self.owned {
            if let Some(action) = self.action.take() {
                if let Err(error) = action() {
                    // Cleanup is best effort and must not replace the original
                    // operation error or make a completed write look retryable.
                    eprintln!("SSH temporary file cleanup failed: {}", error.code);
                }
            }
        }
    }
}

struct Timeout<'a>(&'a Session, u32);
impl<'a> Timeout<'a> {
    fn set(session: &'a Session, timeout: u32) -> Self {
        let old = session.timeout();
        session.set_timeout(timeout);
        Self(session, old)
    }
}
impl Drop for Timeout<'_> {
    fn drop(&mut self) {
        self.0.set_timeout(self.1);
    }
}

impl Manager {
    /// Reserve a remote directory without following an existing path. The
    /// returned guard owns cleanup only after the mkdir succeeds.
    pub(super) fn create_remote_temp_dir(
        &self,
        session_id: &str,
        path: &str,
    ) -> AppResult<RemoteTempDir<'_>> {
        let material = self.material(session_id)?;
        let connection = self.sftp_conn(session_id)?;
        self.ensure_material(&self.auth.lock(), session_id, &material)?;
        {
            let conn = connection.lock();
            let _timeout = Timeout::set(&conn.session, SSH_OPERATION_TIMEOUT_MS);
            conn.sftp.mkdir(Path::new(path), 0o700)?;
        }
        Ok(RemoteTempDir {
            manager: self,
            session_id: session_id.to_string(),
            material,
            preferred: connection,
            path: path.to_string(),
            owned: true,
        })
    }

    /// Only successful exclusive creation establishes ownership. An existing
    /// path or ambiguous create failure must never authorize deleting it.
    pub(super) fn create_remote_temp_file(
        &self,
        session_id: &str,
        path: &str,
    ) -> AppResult<impl Drop + '_> {
        let material = self.material(session_id)?;
        let connection = self.sftp_conn(session_id)?;
        self.ensure_material(&self.auth.lock(), session_id, &material)?;
        let (id, remote) = (session_id.to_string(), path.to_string());
        let preferred = connection.clone();
        let mut cleanup = Cleanup {
            action: Some(move || self.cleanup_remote_file(&id, &material, &preferred, &remote)),
            owned: false,
        };
        {
            let conn = connection.lock();
            let _timeout = Timeout::set(&conn.session, SSH_OPERATION_TIMEOUT_MS);
            let mut file = conn.sftp.open_mode(
                Path::new(path),
                OpenFlags::CREATE | OpenFlags::EXCLUSIVE | OpenFlags::WRITE,
                0o644,
                OpenType::File,
            )?;
            cleanup.owned = true;
            // On a failed close, the stream and connection lock drop before
            // cleanup runs. This avoids recursively taking the same mutex.
            file.close()?;
        }
        Ok(cleanup)
    }

    fn cleanup_remote_file(
        &self,
        session_id: &str,
        material: &Arc<AuthMaterial>,
        preferred: &Arc<Mutex<SftpConn>>,
        path: &str,
    ) -> AppResult<()> {
        let slot = {
            let auth = self.auth.lock();
            // A reused session ID must not redirect cleanup to another host.
            if self.ensure_material(&auth, session_id, material).is_ok() {
                self.sftp.lock().get(session_id).cloned()
            } else {
                None
            }
        };
        let current = slot.and_then(|slot| {
            slot.connection
                .try_lock_for(CLEANUP_LOCK_TIMEOUT)
                .and_then(|cached| cached.clone())
        });
        let connection = current.as_ref().unwrap_or(preferred);
        // Disconnect removes auth/cache registration, but this owned handle
        // still permits cleanup. Never wait behind another long transfer or
        // start an unbounded DNS/authentication sequence from a Drop handler.
        let conn = connection
            .try_lock_for(CLEANUP_LOCK_TIMEOUT)
            .ok_or_else(|| std::io::Error::from(std::io::ErrorKind::TimedOut))?;
        let _timeout = Timeout::set(&conn.session, CLEANUP_IO_TIMEOUT_MS);
        match conn.sftp.unlink(Path::new(path)) {
            Ok(()) => Ok(()),
            Err(error) if matches!(error.code(), ssh2::ErrorCode::SFTP(2 | 10)) => Ok(()),
            Err(error) => Err(error.into()),
        }
    }

    fn cleanup_remote_dir(
        &self,
        session_id: &str,
        material: &Arc<AuthMaterial>,
        preferred: &Arc<Mutex<SftpConn>>,
        path: &str,
    ) -> AppResult<()> {
        let slot = {
            let auth = self.auth.lock();
            if self.ensure_material(&auth, session_id, material).is_ok() {
                self.sftp.lock().get(session_id).cloned()
            } else {
                None
            }
        };
        let current = slot.and_then(|slot| {
            slot.connection
                .try_lock_for(CLEANUP_LOCK_TIMEOUT)
                .and_then(|cached| cached.clone())
        });
        let connection = current.as_ref().unwrap_or(preferred);
        let conn = connection
            .try_lock_for(CLEANUP_LOCK_TIMEOUT)
            .ok_or_else(|| std::io::Error::from(std::io::ErrorKind::TimedOut))?;
        let _timeout = Timeout::set(&conn.session, CLEANUP_IO_TIMEOUT_MS);
        remove_remote_tree(&conn.sftp, Path::new(path))
    }
}

pub(super) struct RemoteTempDir<'a> {
    manager: &'a Manager,
    session_id: String,
    material: Arc<AuthMaterial>,
    preferred: Arc<Mutex<SftpConn>>,
    path: String,
    owned: bool,
}

impl RemoteTempDir<'_> {
    pub(super) fn disarm(&mut self) {
        self.owned = false;
    }
}

impl Drop for RemoteTempDir<'_> {
    fn drop(&mut self) {
        if self.owned {
            if let Err(error) = self.manager.cleanup_remote_dir(
                &self.session_id,
                &self.material,
                &self.preferred,
                &self.path,
            ) {
                eprintln!("SSH temporary directory cleanup failed: {}", error.code);
            }
        }
    }
}

fn remove_remote_tree(sftp: &ssh2::Sftp, path: &Path) -> AppResult<()> {
    let stat = match sftp.lstat(path) {
        Ok(stat) => stat,
        Err(error) if matches!(error.code(), ssh2::ErrorCode::SFTP(2 | 10)) => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    let mode = stat.perm.unwrap_or_default() & 0o170000;
    if mode == 0o040000 {
        for (child, _) in sftp.readdir(path)? {
            remove_remote_tree(sftp, &child)?;
        }
        match sftp.rmdir(path) {
            Ok(()) => Ok(()),
            Err(error) if matches!(error.code(), ssh2::ErrorCode::SFTP(2 | 10)) => Ok(()),
            Err(error) => Err(error.into()),
        }
    } else {
        match sftp.unlink(path) {
            Ok(()) => Ok(()),
            Err(error) if matches!(error.code(), ssh2::ErrorCode::SFTP(2 | 10)) => Ok(()),
            Err(error) => Err(error.into()),
        }
    }
}

#[cfg(test)]
#[path = "remote_temp_tests.rs"]
mod tests;
