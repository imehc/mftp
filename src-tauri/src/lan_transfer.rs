use crate::error::{AppError, AppResult};
use crate::models::{
    LanAuthRequest, LanConnectedDevice, LanNetworkAddress, LanSharedDir, LanTransferSettings,
    LanTransferStatus, LanTransferTask,
};
use local_ip_address::list_afinet_netifas;
use parking_lot::Mutex;
use std::collections::{HashMap, HashSet};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, UdpSocket};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{SystemTime, UNIX_EPOCH};

mod access_routes;
mod auth;
mod browse_routes;
mod browser_client;
mod browser_page;
mod discovery;
mod download_handlers;
mod file_ops;
mod http_io;
mod logging;
mod server;
mod tasks;
mod upload_routes;

use auth::{
    generate_code, is_lan_ipv4, prune_devices, AuthAttemptState, AuthorizedSession,
    PendingAuthRequest,
};
use tasks::prune_tasks;

struct LanServerHandle {
    stop: Arc<AtomicBool>,
    join: Option<JoinHandle<()>>,
    discovery_join: Option<JoinHandle<()>>,
}

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
    tasks: Arc<Mutex<HashMap<String, LanTransferTask>>>,
    handle: LanServerHandle,
}

pub struct LanTransferManager {
    runtime: Mutex<Option<LanServerRuntime>>,
}

impl LanTransferManager {
    pub fn new() -> Self {
        Self {
            runtime: Mutex::new(None),
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
        let mut tasks = runtime.tasks.lock().values().cloned().collect::<Vec<_>>();
        tasks.sort_by_key(|task| std::cmp::Reverse(task.updated_at));
        tasks
    }

    pub fn discover_devices(&self) -> Vec<crate::models::LanDiscoveredDevice> {
        discovery::discover(self.status())
    }

    pub fn cancel_task(&self, id: &str) {
        let runtime = self.runtime.lock();
        let Some(runtime) = runtime.as_ref() else {
            return;
        };
        let mut tasks = runtime.tasks.lock();
        if let Some(task) = tasks.get_mut(id) {
            if task.status == "running" {
                task.status = "canceled".to_string();
                task.updated_at = now_ms();
            }
        }
    }

    pub fn start(
        &self,
        settings: LanTransferSettings,
        shares: Vec<LanSharedDir>,
        trusted_ips: Vec<String>,
        db_path: PathBuf,
    ) -> AppResult<LanTransferStatus> {
        if self.runtime.lock().is_some() {
            return Ok(self.status());
        }

        std::fs::create_dir_all(&settings.download_dir)?;
        for share in &shares {
            let path = Path::new(&share.path);
            if !path.is_dir() {
                return Err(AppError(format!(
                    "共享目录不存在或不可访问：{}",
                    share.path
                )));
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
        let thread_stop = stop.clone();
        let authorized_tokens = Arc::new(Mutex::new(HashMap::<String, AuthorizedSession>::new()));
        let thread_tokens = authorized_tokens.clone();
        let blocked_sessions = Arc::new(Mutex::new(HashSet::<String>::new()));
        let thread_blocked_sessions = blocked_sessions.clone();
        let pending_auth = Arc::new(Mutex::new(HashMap::<String, PendingAuthRequest>::new()));
        let thread_pending_auth = pending_auth.clone();
        let devices = Arc::new(Mutex::new(HashMap::<String, LanConnectedDevice>::new()));
        let thread_devices = devices.clone();
        let tasks = Arc::new(Mutex::new(HashMap::<String, LanTransferTask>::new()));
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
        let join = thread::spawn(move || {
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
        });
        let discovery_stop = stop.clone();
        let discovery_host = host.clone();
        let discovery_id = format!("{discovery_host}:{port}");
        let discovery_join = thread::spawn(move || {
            discovery::run_responder(
                discovery_stop,
                discovery_id,
                discovery_device_name,
                discovery_host,
                port,
            );
        });

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
            handle: LanServerHandle {
                stop,
                join: Some(join),
                discovery_join: Some(discovery_join),
            },
        });
        Ok(self.status())
    }

    pub fn stop(&self) {
        let Some(mut runtime) = self.runtime.lock().take() else {
            return;
        };
        runtime.handle.stop.store(true, Ordering::SeqCst);
        if let Some(join) = runtime.handle.join.take() {
            let _ = join.join();
        }
        if let Some(join) = runtime.handle.discovery_join.take() {
            let _ = join.join();
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
        .map_err(|_| AppError(format!("无效的绑定 IP：{bind_host}")))?;
    if !is_lan_ipv4(ip) {
        return Err(AppError(format!("绑定 IP 不是局域网地址：{bind_host}")));
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
    Err(AppError(format!(
        "无法绑定端口 {}-{}",
        start_port,
        start_port.saturating_add(19)
    )))
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
