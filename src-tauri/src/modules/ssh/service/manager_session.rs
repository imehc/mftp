use super::super::ports::EventSink;
use super::auth::connect;
use super::shell_lifecycle::{ShellCompletion, ShellHandle};
use super::shell_worker::shell_worker;
use super::types::{AuthMaterial, Manager, ShellJob};
use crate::error::{AppError, AppResult, CustomErrorCode};
use std::sync::Arc;

impl Manager {
    pub fn is_busy(&self) -> bool {
        !self.auth.lock().is_empty()
            || !self.shells.lock().is_empty()
            || !self.sftp.lock().is_empty()
            || self
                .transfers
                .lock()
                .values()
                .any(|flag| flag.refs.load(std::sync::atomic::Ordering::SeqCst) != 0)
    }

    /// Register auth material under a new/again session id (no I/O yet).
    pub fn register(&self, session_id: &str, mat: AuthMaterial) {
        self.disconnect(session_id);
        self.auth
            .lock()
            .insert(session_id.to_string(), Arc::new(mat));
    }

    pub(super) fn material(&self, session_id: &str) -> AppResult<Arc<AuthMaterial>> {
        self.auth.lock().get(session_id).cloned().ok_or_else(|| {
            AppError::custom(CustomErrorCode::SshSessionNotFound).with_arg("sessionId", session_id)
        })
    }

    /// Open an interactive shell on a dedicated worker thread.
    pub(crate) fn open_shell(
        &self,
        events: EventSink,
        session_id: &str,
        cols: u32,
        rows: u32,
    ) -> AppResult<()> {
        let mat = self.material(session_id)?;
        let (tx, rx) = std::sync::mpsc::channel::<ShellJob>();
        let handle = Arc::new(ShellHandle::new(tx));
        let completion = {
            // Reserve before network IO without holding the global shell map.
            // Shutdown closes worker admission before inspecting this map.
            let auth = self.auth.lock();
            self.ensure_material(&auth, session_id, &mat)?;
            let mut shells = self.shells.lock();
            if let Some(current) = shells.get(session_id) {
                let current = current.clone();
                drop(shells);
                drop(auth);
                return current.wait_started();
            }
            let lease = self.workers.begin()?;
            shells.insert(session_id.to_string(), handle.clone());
            ShellCompletion {
                shells: self.shells.clone(),
                id: session_id.to_string(),
                handle: handle.clone(),
                _lease: lease,
            }
        };
        let sess = connect(&mat)?;
        let mut channel = sess.channel_session()?;
        channel.request_pty("xterm-256color", None, Some((cols, rows, 0, 0)))?;
        channel.shell()?;
        if handle.is_closing() {
            return Err(AppError::custom(CustomErrorCode::SshShellClosed));
        }
        let id = session_id.to_string();
        std::thread::Builder::new()
            .name("ssh-shell".into())
            .spawn(move || {
                let _completion = completion;
                handle.started();
                shell_worker(events, id, sess, channel, rx, &handle);
            })?;
        Ok(())
    }

    pub fn write(&self, session_id: &str, data: &[u8]) -> AppResult<()> {
        let shells = self.shells.lock();
        let handle = shells
            .get(session_id)
            .ok_or_else(|| AppError::custom(CustomErrorCode::SshShellNotOpen))?;
        if handle.is_closing() {
            return Err(AppError::custom(CustomErrorCode::SshShellClosed));
        }
        handle
            .tx
            .send(ShellJob::Write(data.to_vec()))
            .map_err(|_| AppError::custom(CustomErrorCode::SshShellClosed))
    }

    pub fn resize(&self, session_id: &str, cols: u32, rows: u32) -> AppResult<()> {
        let shells = self.shells.lock();
        if let Some(handle) = shells.get(session_id) {
            let _ = handle.tx.send(ShellJob::Resize(cols, rows));
        }
        Ok(())
    }

    pub fn disconnect(&self, session_id: &str) {
        let shell = {
            // Publication and invalidation use auth -> cache/map lock order.
            let mut auth = self.auth.lock();
            auth.remove(session_id);
            self.sftp.lock().remove(session_id);
            self.clear_monitor_cache(session_id);
            self.shells.lock().get(session_id).cloned()
        };
        if let Some(shell) = shell {
            shell.close();
            shell.wait();
        }
    }

    pub(super) fn ensure_material(
        &self,
        auth: &std::collections::HashMap<String, Arc<AuthMaterial>>,
        session_id: &str,
        material: &Arc<AuthMaterial>,
    ) -> AppResult<()> {
        if auth
            .get(session_id)
            .is_some_and(|current| Arc::ptr_eq(current, material))
        {
            Ok(())
        } else {
            Err(AppError::custom(CustomErrorCode::SshSessionNotFound)
                .with_arg("sessionId", session_id))
        }
    }
}
