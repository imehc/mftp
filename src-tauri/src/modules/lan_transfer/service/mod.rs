use crate::core::operations::Operations;
use crate::error::{AppError, AppResult, CustomErrorCode};
use crate::modules::lan_transfer::{
    LanAuthRequest, LanConnectedDevice, LanNetworkAddress, LanTransferStatus, LanTransferTask,
};
use local_ip_address::list_afinet_netifas;
use parking_lot::Mutex;
use std::collections::{HashMap, HashSet};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, UdpSocket};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tasks::SharedTasks;

mod access_routes;
mod auth;
mod browse_routes;
mod browser_client;
mod browser_page;
mod discovery;
mod download_handlers;
mod file_ops;
mod http_error;
mod http_io;
mod http_request;
mod logging;
mod runtime;
mod server;
mod tasks;
mod transfer_io;
mod upload;
mod upload_file;
mod upload_request;
mod upload_routes;

use auth::{is_lan_ipv4, prune_devices, AuthorizedSession, PendingAuthRequest};
use tasks::prune_tasks;

struct LanServerRuntime {
    host: String,
    port: u16,
    bind_host: String,
    security_mode: String,
    confirmation_code: Option<String>,
    authorized_tokens: Arc<Mutex<HashMap<String, AuthorizedSession>>>,
    blocked_sessions: Arc<Mutex<HashSet<String>>>,
    pending_auth: Arc<Mutex<HashMap<String, PendingAuthRequest>>>,
    devices: Arc<Mutex<HashMap<String, LanConnectedDevice>>>,
    tasks: SharedTasks,
    handle: Option<runtime::LanServerHandle>,
}

pub struct LanTransferManager {
    runtime: Mutex<Option<LanServerRuntime>>,
    // Serialize installation and complete teardown without blocking status reads.
    lifecycle: Mutex<()>,
    closed: AtomicBool,
    operations: Arc<Operations>,
}

impl LanTransferManager {
    pub(crate) fn new(operations: Arc<Operations>) -> Self {
        Self {
            runtime: Mutex::new(None),
            lifecycle: Mutex::new(()),
            closed: AtomicBool::new(false),
            operations,
        }
    }

    pub fn status(&self) -> LanTransferStatus {
        let mut runtime = self.runtime.lock();
        let Some(runtime) = runtime.as_mut() else {
            return LanTransferStatus {
                running: false,
                host: None,
                port: None,
                url: None,
                online_connections: 0,
                auth_mode: "open".to_string(),
                confirmation_code: None,
            };
        };
        if runtime.bind_host.trim().is_empty() {
            if let Some(host) = lan_ip() {
                runtime.host = host;
            }
        }
        prune_devices(&runtime.devices);
        let online_connections = runtime.devices.lock().len();
        LanTransferStatus {
            running: true,
            host: Some(runtime.host.clone()),
            port: Some(runtime.port),
            url: Some(format!("http://{}:{}", runtime.host, runtime.port)),
            online_connections,
            auth_mode: runtime.security_mode.clone(),
            confirmation_code: runtime.confirmation_code.clone(),
        }
    }

    pub fn list_devices(&self) -> Vec<LanConnectedDevice> {
        let runtime = self.runtime.lock();
        let Some(runtime) = runtime.as_ref() else {
            return Vec::new();
        };
        prune_devices(&runtime.devices);
        let mut devices = runtime.devices.lock().values().cloned().collect::<Vec<_>>();
        devices.sort_by_key(|device| std::cmp::Reverse(device.last_seen));
        devices
    }

    pub fn disconnect_device(&self, id: &str) {
        let runtime = self.runtime.lock();
        let Some(runtime) = runtime.as_ref() else {
            return;
        };
        runtime.devices.lock().remove(id);
        runtime.authorized_tokens.lock().remove(id);
        runtime.blocked_sessions.lock().insert(id.to_string());
    }

    pub fn pending_auth_requests(&self) -> Vec<LanAuthRequest> {
        let runtime = self.runtime.lock();
        let Some(runtime) = runtime.as_ref() else {
            return Vec::new();
        };
        auth::list_pending_auth_requests(&runtime.pending_auth)
    }

    pub fn approve_auth_request(&self, id: &str, permission: &str) -> bool {
        let runtime = self.runtime.lock();
        let Some(runtime) = runtime.as_ref() else {
            return false;
        };
        auth::resolve_auth_request(
            &runtime.pending_auth,
            &runtime.authorized_tokens,
            id,
            true,
            permission,
        )
    }

    pub fn reject_auth_request(&self, id: &str) -> bool {
        let runtime = self.runtime.lock();
        let Some(runtime) = runtime.as_ref() else {
            return false;
        };
        auth::resolve_auth_request(
            &runtime.pending_auth,
            &runtime.authorized_tokens,
            id,
            false,
            "readOnly",
        )
    }

    pub fn list_tasks(&self) -> Vec<LanTransferTask> {
        let runtime = self.runtime.lock();
        let Some(runtime) = runtime.as_ref() else {
            return Vec::new();
        };
        prune_tasks(&runtime.tasks);
        let mut tasks = runtime
            .tasks
            .lock()
            .rows
            .values()
            .cloned()
            .collect::<Vec<_>>();
        tasks.sort_by_key(|task| std::cmp::Reverse(task.updated_at));
        tasks
    }

    pub fn discover_devices(
        &self,
    ) -> AppResult<Vec<crate::modules::lan_transfer::LanDiscoveredDevice>> {
        // The discovery probe is independent of the advertised HTTP runtime.
        let _lease = self.operations.begin()?;
        Ok(discovery::discover(self.status()))
    }

    pub fn cancel_task(&self, id: &str) {
        let tasks = self
            .runtime
            .lock()
            .as_ref()
            .map(|runtime| runtime.tasks.clone());
        if let Some(tasks) = tasks {
            tasks::cancel_task(&tasks, id);
        }
    }
}

impl Drop for LanTransferManager {
    fn drop(&mut self) {
        self.stop();
    }
}

pub fn network_addresses() -> Vec<LanNetworkAddress> {
    let recommended = lan_ip();
    let mut seen = HashSet::new();
    let mut items = list_afinet_netifas()
        .map(|addresses| {
            addresses
                .into_iter()
                .filter_map(|(interface_name, ip)| match ip {
                    IpAddr::V4(ip)
                        if is_lan_ipv4(ip) && seen.insert((interface_name.clone(), ip)) =>
                    {
                        Some(LanNetworkAddress {
                            interface_name,
                            ip: ip.to_string(),
                            recommended: recommended.as_deref() == Some(&ip.to_string()),
                        })
                    }
                    _ => None,
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    items.sort_by(|a, b| {
        b.recommended
            .cmp(&a.recommended)
            .then_with(|| a.interface_name.cmp(&b.interface_name))
            .then_with(|| a.ip.cmp(&b.ip))
    });
    items
}

fn selected_bind_host(bind_host: &str) -> AppResult<Option<Ipv4Addr>> {
    let bind_host = bind_host.trim();
    if bind_host.is_empty() {
        return Ok(None);
    }
    let ip = bind_host
        .parse::<Ipv4Addr>()
        .map_err(|_| AppError::custom(CustomErrorCode::LanIpInvalid).with_arg("ip", bind_host))?;
    if !is_lan_ipv4(ip) {
        return Err(AppError::custom(CustomErrorCode::LanBindIpNotLan).with_arg("ip", bind_host));
    }
    Ok(Some(ip))
}

fn bind_with_port_fallback(start_port: u16, bind_host: Option<Ipv4Addr>) -> AppResult<TcpListener> {
    let host = bind_host.unwrap_or(Ipv4Addr::UNSPECIFIED);
    for offset in 0..20u16 {
        let port = start_port.saturating_add(offset);
        if let Ok(listener) = TcpListener::bind(SocketAddr::from((host, port))) {
            return Ok(listener);
        }
    }
    Err(AppError::custom(CustomErrorCode::LanBindPortUnavailable)
        .with_arg("startPort", start_port)
        .with_arg("endPort", start_port.saturating_add(19)))
}

fn lan_ip() -> Option<String> {
    let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    socket.connect((Ipv4Addr::new(8, 8, 8, 8), 80)).ok()?;
    match socket.local_addr().ok()?.ip() {
        IpAddr::V4(ip) if !ip.is_loopback() => Some(ip.to_string()),
        _ => None,
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn escape_json(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

#[cfg(test)]
mod tests;
