use crate::models::{LanConnectedDevice, LanSharedDir, LanTransferTask};
use parking_lot::Mutex;
use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use super::auth::{
    auth_decision_json, authorize, can_read, can_upload, client_name_from_request,
    create_or_touch_auth_request, current_permission, is_allowed_peer_ip, is_authorized,
    normalize_permission, session_id_from_request, touch_device, touch_device_from_request,
    AuthAttemptState, AuthorizeOutcome, AuthorizedSession, PendingAuthRequest,
};
use super::browser_page;
use super::escape_json;
use super::file_ops::{
    browse_json, save_upload, shares_json, upload_offset_json, upload_target_exists,
};
use super::http_io::{reject_transfer_limit, write_response, write_response_with_headers};
use super::logging::{record_access, record_transfer_history};
use super::tasks::try_acquire_transfer;

pub(super) fn run_http_server(
    listener: TcpListener,
    stop: Arc<AtomicBool>,
    device_name: String,
    download_dir: String,
    shares: Vec<LanSharedDir>,
    security_mode: String,
    default_permission: String,
    max_concurrent_transfers: usize,
    trusted_ips: Vec<String>,
    confirmation_code: Option<String>,
    authorized_tokens: Arc<Mutex<HashMap<String, AuthorizedSession>>>,
    blocked_sessions: Arc<Mutex<HashSet<String>>>,
    pending_auth: Arc<Mutex<HashMap<String, PendingAuthRequest>>>,
    devices: Arc<Mutex<HashMap<String, LanConnectedDevice>>>,
    tasks: Arc<Mutex<HashMap<String, LanTransferTask>>>,
    active_transfers: Arc<Mutex<usize>>,
    auth_attempts: Arc<Mutex<HashMap<String, AuthAttemptState>>>,
    db_path: PathBuf,
) {
    while !stop.load(Ordering::SeqCst) {
        match listener.accept() {
            Ok((stream, addr)) => {
                let peer_ip = addr.ip().to_string();
                let device_name = device_name.clone();
                let download_dir = download_dir.clone();
                let shares = shares.clone();
                let security_mode = security_mode.clone();
                let default_permission = default_permission.clone();
                let trusted_ips = trusted_ips.clone();
                let confirmation_code = confirmation_code.clone();
                let authorized_tokens = authorized_tokens.clone();
                let blocked_sessions = blocked_sessions.clone();
                let pending_auth = pending_auth.clone();
                let devices = devices.clone();
                let tasks = tasks.clone();
                let active_transfers = active_transfers.clone();
                let auth_attempts = auth_attempts.clone();
                let db_path = db_path.clone();
                thread::spawn(move || {
                    handle_connection(
                        stream,
                        peer_ip,
                        &device_name,
                        &download_dir,
                        &shares,
                        &security_mode,
                        &default_permission,
                        &trusted_ips,
                        confirmation_code.as_deref(),
                        &authorized_tokens,
                        &blocked_sessions,
                        &pending_auth,
                        &devices,
                        &tasks,
                        &active_transfers,
                        max_concurrent_transfers,
                        &auth_attempts,
                        &db_path,
                    );
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(60));
            }
            Err(_) => thread::sleep(Duration::from_millis(120)),
        }
    }
}

fn handle_connection(
    mut stream: TcpStream,
    peer_ip: String,
    device_name: &str,
    download_dir: &str,
    shares: &[LanSharedDir],
    security_mode: &str,
    default_permission: &str,
    trusted_ips: &[String],
    confirmation_code: Option<&str>,
    authorized_tokens: &Arc<Mutex<HashMap<String, AuthorizedSession>>>,
    blocked_sessions: &Arc<Mutex<HashSet<String>>>,
    pending_auth: &Arc<Mutex<HashMap<String, PendingAuthRequest>>>,
    devices: &Arc<Mutex<HashMap<String, LanConnectedDevice>>>,
    tasks: &Arc<Mutex<HashMap<String, LanTransferTask>>>,
    active_transfers: &Arc<Mutex<usize>>,
    max_concurrent_transfers: usize,
    auth_attempts: &Arc<Mutex<HashMap<String, AuthAttemptState>>>,
    db_path: &Path,
) {
    let mut buffer = [0_u8; 2048];
    let Ok(n) = stream.read(&mut buffer) else {
        return;
    };
    let request = String::from_utf8_lossy(&buffer[..n]);
    let first_line = request.lines().next().unwrap_or_default();
    if !is_allowed_peer_ip(&peer_ip) {
        record_access(db_path, &peer_ip, "request", "denied", Some("non-lan ip"));
        let _ = write_response(&mut stream, "403 Forbidden", "text/plain", b"Forbidden");
        return;
    }
    if let Some(session_id) = session_id_from_request(&request, security_mode, &peer_ip) {
        if blocked_sessions.lock().contains(&session_id) {
            record_access(db_path, &peer_ip, "request", "denied", Some("disconnected"));
            let _ = write_response(&mut stream, "403 Forbidden", "text/plain", b"Disconnected");
            return;
        }
    }
    if first_line.starts_with("GET / ") || first_line.starts_with("GET /index.html ") {
        let html = browser_page::browser_home(device_name, security_mode);
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
    } else if first_line.starts_with("GET /api/status ") {
        let authorized = is_authorized(
            &request,
            security_mode,
            authorized_tokens,
            trusted_ips,
            &peer_ip,
        );
        let permission = current_permission(
            &request,
            security_mode,
            default_permission,
            trusted_ips,
            authorized_tokens,
            &peer_ip,
        );
        if authorized {
            touch_device_from_request(
                devices,
                &request,
                security_mode,
                &peer_ip,
                &permission,
                "status",
            );
        }
        let body = format!(
            r#"{{"deviceName":"{}","status":"running","authorized":{},"authMode":"{}","permission":"{}","canRead":{},"canUpload":{}}}"#,
            escape_json(device_name),
            authorized,
            escape_json(security_mode),
            escape_json(normalize_permission(&permission)),
            can_read(&permission),
            can_upload(&permission)
        );
        let _ = write_response(
            &mut stream,
            "200 OK",
            "application/json; charset=utf-8",
            body.as_bytes(),
        );
    } else if first_line.starts_with("POST /api/authorize?") {
        match authorize(
            first_line,
            confirmation_code,
            authorized_tokens,
            auth_attempts,
            &peer_ip,
            default_permission,
        ) {
            AuthorizeOutcome::Allowed(token) => {
                touch_device(
                    devices,
                    token.clone(),
                    &peer_ip,
                    default_permission,
                    &client_name_from_request(&request),
                    "authorized",
                );
                record_access(db_path, &peer_ip, "authorize", "success", None);
                let body = br#"{"ok":true}"#;
                let header = format!("Set-Cookie: mftp_token={token}; Path=/; SameSite=Lax\r\n");
                let _ = write_response_with_headers(
                    &mut stream,
                    "200 OK",
                    "application/json; charset=utf-8",
                    &[header],
                    body,
                );
            }
            AuthorizeOutcome::Denied => {
                record_access(db_path, &peer_ip, "authorize", "denied", Some("bad code"));
                let _ = write_response(
                    &mut stream,
                    "403 Forbidden",
                    "application/json; charset=utf-8",
                    br#"{"ok":false}"#,
                );
            }
            AuthorizeOutcome::Banned => {
                record_access(
                    db_path,
                    &peer_ip,
                    "authorize",
                    "blocked",
                    Some("too many attempts"),
                );
                let _ = write_response(
                    &mut stream,
                    "429 Too Many Requests",
                    "application/json; charset=utf-8",
                    br#"{"ok":false,"banned":true}"#,
                );
            }
        }
    } else if first_line.starts_with("POST /api/request-access?") {
        if !matches!(security_mode, "confirm" | "trusted") {
            let _ = write_response(
                &mut stream,
                "400 Bad Request",
                "application/json",
                br#"{"error":"unsupported"}"#,
            );
            return;
        }
        let access_type = super::file_ops::request_query_param(first_line, "type")
            .unwrap_or_else(|| "browser".to_string());
        let id = create_or_touch_auth_request(
            pending_auth,
            &peer_ip,
            &client_name_from_request(&request),
            &access_type,
        );
        record_access(db_path, &peer_ip, "authorize_request", "pending", Some(&id));
        let body = format!(r#"{{"id":"{}","status":"pending"}}"#, escape_json(&id));
        let _ = write_response(
            &mut stream,
            "200 OK",
            "application/json; charset=utf-8",
            body.as_bytes(),
        );
    } else if first_line.starts_with("GET /api/access-decision?") {
        let Some(id) = super::file_ops::request_query_param(first_line, "id") else {
            let _ = write_response(
                &mut stream,
                "400 Bad Request",
                "application/json",
                br#"{"error":"missing id"}"#,
            );
            return;
        };
        let (body, token) = auth_decision_json(pending_auth, &id);
        if let Some((token, permission)) = token {
            touch_device(
                devices,
                token.clone(),
                &peer_ip,
                &permission,
                &client_name_from_request(&request),
                "authorized",
            );
            record_access(db_path, &peer_ip, "authorize", "success", Some("confirm"));
            let header = format!("Set-Cookie: mftp_token={token}; Path=/; SameSite=Lax\r\n");
            let _ = write_response_with_headers(
                &mut stream,
                "200 OK",
                "application/json; charset=utf-8",
                &[header],
                body.as_bytes(),
            );
        } else {
            let _ = write_response(
                &mut stream,
                "200 OK",
                "application/json; charset=utf-8",
                body.as_bytes(),
            );
        }
    } else if first_line.starts_with("GET /api/shares ") {
        if !is_authorized(
            &request,
            security_mode,
            authorized_tokens,
            trusted_ips,
            &peer_ip,
        ) {
            record_access(db_path, &peer_ip, "shares", "denied", Some("unauthorized"));
            let _ = write_response(
                &mut stream,
                "403 Forbidden",
                "application/json",
                br#"{"error":"unauthorized"}"#,
            );
            return;
        }
        let permission = current_permission(
            &request,
            security_mode,
            default_permission,
            trusted_ips,
            authorized_tokens,
            &peer_ip,
        );
        if !can_read(&permission) {
            record_access(db_path, &peer_ip, "shares", "denied", Some("permission"));
            let _ = write_response(
                &mut stream,
                "403 Forbidden",
                "application/json",
                br#"{"error":"permission"}"#,
            );
            return;
        }
        touch_device_from_request(
            devices,
            &request,
            security_mode,
            &peer_ip,
            &permission,
            "shares",
        );
        let body = shares_json(shares);
        let _ = write_response(
            &mut stream,
            "200 OK",
            "application/json; charset=utf-8",
            body.as_bytes(),
        );
    } else if first_line.starts_with("GET /api/browse?") {
        if !is_authorized(
            &request,
            security_mode,
            authorized_tokens,
            trusted_ips,
            &peer_ip,
        ) {
            record_access(db_path, &peer_ip, "browse", "denied", Some("unauthorized"));
            let _ = write_response(
                &mut stream,
                "403 Forbidden",
                "application/json",
                br#"{"error":"unauthorized"}"#,
            );
            return;
        }
        let permission = current_permission(
            &request,
            security_mode,
            default_permission,
            trusted_ips,
            authorized_tokens,
            &peer_ip,
        );
        if !can_read(&permission) {
            record_access(db_path, &peer_ip, "browse", "denied", Some("permission"));
            let _ = write_response(
                &mut stream,
                "403 Forbidden",
                "application/json",
                br#"{"error":"permission"}"#,
            );
            return;
        }
        touch_device_from_request(
            devices,
            &request,
            security_mode,
            &peer_ip,
            &permission,
            "browse",
        );
        let body = match browse_json(first_line, shares) {
            Ok(body) => {
                record_access(db_path, &peer_ip, "browse", "success", None);
                body
            }
            Err(error) => {
                record_access(db_path, &peer_ip, "browse", "failed", Some(&error.0));
                format!(r#"{{"error":"{}"}}"#, escape_json(&error.0))
            }
        };
        let _ = write_response(
            &mut stream,
            "200 OK",
            "application/json; charset=utf-8",
            body.as_bytes(),
        );
    } else if first_line.starts_with("HEAD /download?") {
        super::download_handlers::handle_download_head(
            &mut stream,
            super::download_handlers::DownloadContext {
                request: &request,
                first_line,
                peer_ip: &peer_ip,
                shares,
                security_mode,
                default_permission,
                trusted_ips,
                authorized_tokens,
                devices,
                tasks,
                active_transfers,
                max_concurrent_transfers,
                db_path,
            },
        );
    } else if first_line.starts_with("GET /download?") {
        super::download_handlers::handle_download(
            &mut stream,
            super::download_handlers::DownloadContext {
                request: &request,
                first_line,
                peer_ip: &peer_ip,
                shares,
                security_mode,
                default_permission,
                trusted_ips,
                authorized_tokens,
                devices,
                tasks,
                active_transfers,
                max_concurrent_transfers,
                db_path,
            },
        );
    } else if first_line.starts_with("GET /api/upload-exists?")
        || first_line.starts_with("GET /api/upload-offset?")
    {
        if !is_authorized(
            &request,
            security_mode,
            authorized_tokens,
            trusted_ips,
            &peer_ip,
        ) {
            let _ = write_response(
                &mut stream,
                "403 Forbidden",
                "application/json",
                br#"{"error":"unauthorized"}"#,
            );
            return;
        }
        let permission = current_permission(
            &request,
            security_mode,
            default_permission,
            trusted_ips,
            authorized_tokens,
            &peer_ip,
        );
        if !can_upload(&permission) {
            let _ = write_response(
                &mut stream,
                "403 Forbidden",
                "application/json",
                br#"{"error":"permission"}"#,
            );
            return;
        }
        let body = if first_line.starts_with("GET /api/upload-offset?") {
            upload_offset_json(first_line, download_dir)
                .unwrap_or_else(|error| format!(r#"{{"error":"{}"}}"#, escape_json(&error.0)))
        } else {
            let exists = upload_target_exists(first_line, download_dir).unwrap_or(false);
            format!(r#"{{"exists":{exists}}}"#)
        };
        let _ = write_response(
            &mut stream,
            "200 OK",
            "application/json; charset=utf-8",
            body.as_bytes(),
        );
    } else if first_line.starts_with("POST /api/upload?") {
        if !is_authorized(
            &request,
            security_mode,
            authorized_tokens,
            trusted_ips,
            &peer_ip,
        ) {
            record_access(db_path, &peer_ip, "upload", "denied", Some("unauthorized"));
            let _ = write_response(&mut stream, "403 Forbidden", "text/plain", b"Unauthorized");
            return;
        }
        let permission = current_permission(
            &request,
            security_mode,
            default_permission,
            trusted_ips,
            authorized_tokens,
            &peer_ip,
        );
        if !can_upload(&permission) {
            record_access(db_path, &peer_ip, "upload", "denied", Some("permission"));
            let _ = write_response(&mut stream, "403 Forbidden", "text/plain", b"Forbidden");
            return;
        }
        touch_device_from_request(
            devices,
            &request,
            security_mode,
            &peer_ip,
            &permission,
            "upload",
        );
        let Some(_permit) = try_acquire_transfer(active_transfers, max_concurrent_transfers) else {
            record_access(
                db_path,
                &peer_ip,
                "upload",
                "denied",
                Some("transfer limit"),
            );
            reject_transfer_limit(&mut stream, max_concurrent_transfers);
            return;
        };
        match save_upload(
            &request,
            &buffer[..n],
            &mut stream,
            download_dir,
            tasks,
            &peer_ip,
        ) {
            Ok(file_name) => {
                record_access(db_path, &peer_ip, "upload", "success", Some(&file_name));
                record_transfer_history(db_path, &peer_ip, "upload", &file_name, "success", None);
            }
            Err(error) => {
                let result = if error.0 == "transfer canceled" {
                    "canceled"
                } else {
                    "failed"
                };
                record_access(db_path, &peer_ip, "upload", result, Some(&error.0));
                record_transfer_history(db_path, &peer_ip, "upload", "-", result, Some(&error.0));
                let _ = write_response(
                    &mut stream,
                    "400 Bad Request",
                    "text/plain; charset=utf-8",
                    error.0.as_bytes(),
                );
            }
        }
    } else {
        let _ = write_response(
            &mut stream,
            "404 Not Found",
            "text/plain; charset=utf-8",
            b"Not found",
        );
    }
}
