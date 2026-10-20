use super::auth::connect;
use super::types::{AuthMaterial, CachedConn, Manager, SftpConn, SftpSlot};
use crate::error::{AppError, AppResult, CustomErrorCode};
use parking_lot::Mutex;
use std::sync::Arc;

impl Manager {
    pub(super) fn sftp_conn(&self, session_id: &str) -> AppResult<Arc<Mutex<SftpConn>>> {
        self.slot_conn(session_id, |slot| &slot.connection)
    }

    /// File transfers use their own connection so browsing is not blocked
    /// behind a long upload or download.
    pub(super) fn transfer_conn(&self, session_id: &str) -> AppResult<Arc<Mutex<SftpConn>>> {
        self.slot_conn(session_id, |slot| &slot.transfer)
    }

    fn slot_conn(
        &self,
        session_id: &str,
        select: fn(&SftpSlot) -> &CachedConn,
    ) -> AppResult<Arc<Mutex<SftpConn>>> {
        let material = self.material(session_id)?;
        let slot = {
            let auth = self.auth.lock();
            self.ensure_material(&auth, session_id, &material)?;
            self.sftp
                .lock()
                .entry(session_id.to_string())
                .or_default()
                .clone()
        };
        // Serialize initialization only within this session. Disconnect/reset
        // detach the slot without waiting on a network call or connection lock.
        let mut cached = select(&slot).lock();
        self.with_current_slot(session_id, &material, &slot, || ())?;
        if let Some(connection) = cached.as_ref() {
            return Ok(connection.clone());
        }
        let session = connect(&material)?;
        let sftp = super::diagnostics::call(
            "ssh.sftp",
            serde_json::json!({}),
            || session.sftp(),
            super::diagnostics::unit,
        )?;
        let sftp = super::logged_sftp::LoggedSftp::new(sftp);
        let connection = Arc::new(Mutex::new(SftpConn { sftp, session }));
        self.with_current_slot(session_id, &material, &slot, || {
            *cached = Some(connection.clone());
        })?;
        Ok(connection)
    }

    fn with_current_slot<T>(
        &self,
        session_id: &str,
        material: &Arc<AuthMaterial>,
        slot: &Arc<SftpSlot>,
        publish: impl FnOnce() -> T,
    ) -> AppResult<T> {
        // Never acquire the slot/connection lock under auth or the cache map.
        // Holding these short locks through publication makes reset atomic.
        let auth = self.auth.lock();
        self.ensure_material(&auth, session_id, material)?;
        let slots = self.sftp.lock();
        if !slots
            .get(session_id)
            .is_some_and(|current| Arc::ptr_eq(current, slot))
        {
            return Err(AppError::custom(CustomErrorCode::SshSessionNotFound)
                .with_arg("sessionId", session_id));
        }
        Ok(publish())
    }

    pub(super) fn remove_sftp_conn_if_current(
        &self,
        session_id: &str,
        conn: &Arc<Mutex<SftpConn>>,
    ) {
        let slot = self.sftp.lock().get(session_id).cloned();
        if let Some(slot) = slot {
            for entry in [&slot.connection, &slot.transfer] {
                let mut cached = entry.lock();
                if cached
                    .as_ref()
                    .is_some_and(|current| Arc::ptr_eq(current, conn))
                {
                    *cached = None;
                }
            }
        }
    }

    pub fn reset_sftp_conn(&self, session_id: &str) {
        self.sftp.lock().remove(session_id);
    }
}

#[cfg(test)]
#[path = "sftp_connection_tests.rs"]
mod tests;
