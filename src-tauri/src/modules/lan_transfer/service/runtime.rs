use super::auth::{generate_code, AuthAttemptState, AuthorizedSession, PendingAuthRequest};
use super::tasks::SharedTasks;
use super::{bind_with_port_fallback, discovery, lan_ip, selected_bind_host, server};
use super::{LanServerRuntime, LanTransferManager};
use crate::core::operations::OperationLease;
use crate::error::{AppError, AppResult, CustomErrorCode};
use crate::modules::lan_transfer::{
    LanConnectedDevice, LanSharedDir, LanTransferSettings, LanTransferStatus,
};
use parking_lot::Mutex;
use std::collections::{HashMap, HashSet};
use std::net::Ipv4Addr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};

pub(super) struct LanServerHandle {
    stop: Arc<AtomicBool>,
    join: Option<JoinHandle<()>>,
    discovery_join: Option<JoinHandle<()>>,
    // Released only after Drop has joined all runtime workers and their logs.
    _lease: OperationLease,
}

impl Drop for LanServerHandle {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(join) = self.discovery_join.take() {
            let _ = join.join();
        }
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

impl LanTransferManager {
    pub fn start(
        &self,
        settings: LanTransferSettings,
        shares: Vec<LanSharedDir>,
        trusted_ips: Vec<String>,
        db_path: PathBuf,
    ) -> AppResult<LanTransferStatus> {
        let lease = self.operations.begin()?;
        let _lifecycle = self.lifecycle.lock();
        // Admission is rechecked after queued starts acquire the lifecycle lock.
        self.operations.check_admission()?;
        if self.closed.load(Ordering::SeqCst) {
            return Err(AppError::custom(CustomErrorCode::AppShuttingDown));
        }
        if self.runtime.lock().is_some() {
            return Ok(self.status());
        }

        std::fs::create_dir_all(&settings.download_dir)?;
        for share in &shares {
            let path = Path::new(&share.path);
            if !path.is_dir() {
                return Err(AppError::custom(CustomErrorCode::LanSharedDirUnavailable)
                    .with_arg("name", &share.name));
            }
        }

        let selected_host = selected_bind_host(&settings.bind_host)?;
        let host = selected_host
            .map(|ip| ip.to_string())
            .or_else(lan_ip)
            .unwrap_or_else(|| Ipv4Addr::LOCALHOST.to_string());
        let listener = bind_with_port_fallback(settings.port, selected_host)?;
        let port = listener.local_addr()?.port();
        listener.set_nonblocking(true)?;

        let stop = Arc::new(AtomicBool::new(false));
        // Own the lease and every started thread before any later fallible step.
        // Drop rolls a partial installation back in reverse order.
        let mut handle = LanServerHandle {
            stop: stop.clone(),
            join: None,
            discovery_join: None,
            _lease: lease,
        };
        let thread_stop = stop.clone();
        let authorized_tokens = Arc::new(Mutex::new(HashMap::<String, AuthorizedSession>::new()));
        let thread_tokens = authorized_tokens.clone();
        let blocked_sessions = Arc::new(Mutex::new(HashSet::<String>::new()));
        let thread_blocked_sessions = blocked_sessions.clone();
        let pending_auth = Arc::new(Mutex::new(HashMap::<String, PendingAuthRequest>::new()));
        let thread_pending_auth = pending_auth.clone();
        let devices = Arc::new(Mutex::new(HashMap::<String, LanConnectedDevice>::new()));
        let thread_devices = devices.clone();
        let tasks = SharedTasks::default();
        let thread_tasks = tasks.clone();
        let auth_attempts = Arc::new(Mutex::new(HashMap::<String, AuthAttemptState>::new()));
        let thread_attempts = auth_attempts.clone();
        let confirmation_code = (settings.security_mode == "code").then(generate_code);
        let thread_confirmation_code = confirmation_code.clone();
        let device_name = settings.device_name;
        let discovery_device_name = device_name.clone();
        let download_dir = settings.download_dir;
        let security_mode = settings.security_mode;
        let runtime_security_mode = security_mode.clone();
        let default_permission = settings.default_permission;
        let max_concurrent_transfers = settings.max_concurrent_transfers.max(1) as usize;
        let active_transfers = Arc::new(Mutex::new(0_usize));
        let thread_active_transfers = active_transfers.clone();
        handle.join = Some(
            thread::Builder::new()
                .name("lan-http".into())
                .spawn(move || {
                    server::run_http_server(
                        listener,
                        thread_stop,
                        server::ServerContext {
                            device_name,
                            download_dir,
                            shares,
                            security_mode,
                            default_permission,
                            max_concurrent_transfers,
                            trusted_ips,
                            confirmation_code: thread_confirmation_code,
                            authorized_tokens: thread_tokens,
                            blocked_sessions: thread_blocked_sessions,
                            pending_auth: thread_pending_auth,
                            devices: thread_devices,
                            tasks: thread_tasks,
                            active_transfers: thread_active_transfers,
                            auth_attempts: thread_attempts,
                            db_path,
                        },
                    )
                })?,
        );
        let discovery_stop = stop.clone();
        let discovery_host = host.clone();
        let discovery_id = format!("{discovery_host}:{port}");
        handle.discovery_join = Some(thread::Builder::new().name("lan-discovery".into()).spawn(
            move || {
                discovery::run_responder(
                    discovery_stop,
                    discovery_id,
                    discovery_device_name,
                    discovery_host,
                    port,
                );
            },
        )?);

        *self.runtime.lock() = Some(LanServerRuntime {
            host,
            port,
            bind_host: settings.bind_host,
            security_mode: runtime_security_mode,
            confirmation_code,
            authorized_tokens,
            blocked_sessions,
            pending_auth,
            devices,
            tasks,
            handle: Some(handle),
        });
        Ok(self.status())
    }

    pub fn stop(&self) {
        let _lifecycle = self.lifecycle.lock();
        let handle = self
            .runtime
            .lock()
            .as_mut()
            .and_then(|runtime| runtime.handle.take());
        // Keep status running until all old connections, file handles and logs
        // have finished. A new start cannot replace this generation mid-stop.
        drop(handle);
        self.runtime.lock().take();
    }

    pub(crate) fn shutdown(&self) {
        self.closed.store(true, Ordering::SeqCst);
        self.stop();
    }
}

#[cfg(test)]
#[path = "runtime_tests.rs"]
mod tests;
