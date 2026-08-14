use crate::models::{LanConnectedDevice, LanSharedDir, LanTransferTask};
use parking_lot::Mutex;
use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use super::auth::{
    is_allowed_peer_ip, session_id_from_request, AuthAttemptState, AuthorizedSession,
    PendingAuthRequest,
};
use super::browser_page;
use super::http_io::{write_response, write_response_with_headers};
use super::logging::record_access;

#[derive(Clone)]
pub(super) struct ServerContext {
    pub(super) device_name: String,
    pub(super) download_dir: String,
    pub(super) shares: Vec<LanSharedDir>,
    pub(super) security_mode: String,
    pub(super) default_permission: String,
    pub(super) max_concurrent_transfers: usize,
    pub(super) trusted_ips: Vec<String>,
    pub(super) confirmation_code: Option<String>,
    pub(super) authorized_tokens: Arc<Mutex<HashMap<String, AuthorizedSession>>>,
    pub(super) blocked_sessions: Arc<Mutex<HashSet<String>>>,
    pub(super) pending_auth: Arc<Mutex<HashMap<String, PendingAuthRequest>>>,
    pub(super) devices: Arc<Mutex<HashMap<String, LanConnectedDevice>>>,
    pub(super) tasks: Arc<Mutex<HashMap<String, LanTransferTask>>>,
    pub(super) active_transfers: Arc<Mutex<usize>>,
    pub(super) auth_attempts: Arc<Mutex<HashMap<String, AuthAttemptState>>>,
    pub(super) db_path: PathBuf,
}

pub(super) fn run_http_server(
    listener: TcpListener,
    stop: Arc<AtomicBool>,
    context: ServerContext,
) {
    let context = Arc::new(context);
    while !stop.load(Ordering::SeqCst) {
        match listener.accept() {
            Ok((stream, addr)) => {
                let peer_ip = addr.ip().to_string();
                let context = context.clone();
                thread::spawn(move || {
                    handle_connection(stream, peer_ip, &context);
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(60));
            }
            Err(_) => thread::sleep(Duration::from_millis(120)),
        }
    }
}

fn handle_connection(mut stream: TcpStream, peer_ip: String, context: &ServerContext) {
    let mut buffer = [0_u8; 2048];
    let Ok(n) = stream.read(&mut buffer) else {
        return;
    };
    let request = String::from_utf8_lossy(&buffer[..n]);
    let first_line = request.lines().next().unwrap_or_default();
    if !is_allowed_peer_ip(&peer_ip) {
        record_access(
            &context.db_path,
            &peer_ip,
            "request",
            "denied",
            Some("non-lan ip"),
        );
        let _ = write_response(&mut stream, "403 Forbidden", "text/plain", b"Forbidden");
        return;
    }
    if let Some(session_id) = session_id_from_request(&request, &context.security_mode, &peer_ip) {
        if context.blocked_sessions.lock().contains(&session_id) {
            record_access(
                &context.db_path,
                &peer_ip,
                "request",
                "denied",
                Some("disconnected"),
            );
            let _ = write_response(&mut stream, "403 Forbidden", "text/plain", b"Disconnected");
            return;
        }
    }
    if first_line.starts_with("GET / ") || first_line.starts_with("GET /index.html ") {
        let html = browser_page::browser_home(&context.device_name, &context.security_mode);
        let _ = write_response_with_headers(
            &mut stream,
            "200 OK",
            "text/html; charset=utf-8",
            &["Cache-Control: no-store\r\n".to_string()],
            html.as_bytes(),
        );
    } else if first_line.starts_with("GET /browser.css ") {
        let _ = write_response_with_headers(
            &mut stream,
            "200 OK",
            "text/css; charset=utf-8",
            &["Cache-Control: no-store\r\n".to_string()],
            super::browser_client::BROWSER_CSS.as_bytes(),
        );
    } else if first_line.starts_with("GET /browser.js ") {
        let _ = write_response_with_headers(
            &mut stream,
            "200 OK",
            "application/javascript; charset=utf-8",
            &["Cache-Control: no-store\r\n".to_string()],
            super::browser_client::BROWSER_JS.as_bytes(),
        );
    } else if super::access_routes::handle(&mut stream, &request, first_line, &peer_ip, context)
        || super::browse_routes::handle(&mut stream, &request, first_line, &peer_ip, context)
    {
    } else if first_line.starts_with("HEAD /download?") {
        super::download_handlers::handle_download_head(
            &mut stream,
            super::download_handlers::DownloadContext {
                request: &request,
                first_line,
                peer_ip: &peer_ip,
                shares: &context.shares,
                security_mode: &context.security_mode,
                default_permission: &context.default_permission,
                trusted_ips: &context.trusted_ips,
                authorized_tokens: &context.authorized_tokens,
                devices: &context.devices,
                tasks: &context.tasks,
                active_transfers: &context.active_transfers,
                max_concurrent_transfers: context.max_concurrent_transfers,
                db_path: &context.db_path,
            },
        );
    } else if first_line.starts_with("GET /download?") {
        super::download_handlers::handle_download(
            &mut stream,
            super::download_handlers::DownloadContext {
                request: &request,
                first_line,
                peer_ip: &peer_ip,
                shares: &context.shares,
                security_mode: &context.security_mode,
                default_permission: &context.default_permission,
                trusted_ips: &context.trusted_ips,
                authorized_tokens: &context.authorized_tokens,
                devices: &context.devices,
                tasks: &context.tasks,
                active_transfers: &context.active_transfers,
                max_concurrent_transfers: context.max_concurrent_transfers,
                db_path: &context.db_path,
            },
        );
    } else if super::upload_routes::handle(
        &mut stream,
        &request,
        first_line,
        &peer_ip,
        &buffer[..n],
        context,
    ) {
    } else {
        let _ = write_response(
            &mut stream,
            "404 Not Found",
            "text/plain; charset=utf-8",
            b"Not found",
        );
    }
}
