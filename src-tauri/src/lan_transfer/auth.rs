use crate::models::{LanAuthRequest, LanConnectedDevice};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const MAX_AUTH_FAILURES: u32 = 5;
const AUTH_BAN_DURATION: Duration = Duration::from_secs(10 * 60);
const SESSION_TIMEOUT: Duration = Duration::from_secs(30 * 60);

pub(super) struct AuthAttemptState {
    failures: u32,
    banned_until: Option<Instant>,
}

pub(super) struct AuthorizedSession {
    pub last_seen: Instant,
    pub permission: String,
}

#[derive(Clone)]
pub(super) enum PendingAuthStatus {
    Pending,
    Approved { token: String, permission: String },
    Rejected,
}

#[derive(Clone)]
pub(super) struct PendingAuthRequest {
    pub id: String,
    pub ip: String,
    pub device_name: String,
    pub access_type: String,
    pub requested_at: i64,
    pub status: PendingAuthStatus,
}

pub(super) enum AuthorizeOutcome {
    Allowed(String),
    Denied,
    Banned,
}

pub(super) fn authorize(
    first_line: &str,
    confirmation_code: Option<&str>,
    authorized_tokens: &Arc<Mutex<HashMap<String, AuthorizedSession>>>,
    auth_attempts: &Arc<Mutex<HashMap<String, AuthAttemptState>>>,
    peer_ip: &str,
    permission: &str,
) -> AuthorizeOutcome {
    if is_banned(auth_attempts, peer_ip) {
        return AuthorizeOutcome::Banned;
    }

    let Some(query) = first_line
        .split_whitespace()
        .nth(1)
        .and_then(|target| target.split_once('?').map(|(_, query)| query))
    else {
        record_auth_failure(auth_attempts, peer_ip);
        return AuthorizeOutcome::Denied;
    };
    let Some(code) = super::file_ops::query_param(query, "code") else {
        record_auth_failure(auth_attempts, peer_ip);
        return AuthorizeOutcome::Denied;
    };
    if Some(code.as_str()) != confirmation_code {
        record_auth_failure(auth_attempts, peer_ip);
        return if is_banned(auth_attempts, peer_ip) {
            AuthorizeOutcome::Banned
        } else {
            AuthorizeOutcome::Denied
        };
    }
    auth_attempts.lock().remove(peer_ip);
    let token = uuid::Uuid::new_v4().to_string();
    insert_authorized_session(authorized_tokens, token.clone(), permission);
    AuthorizeOutcome::Allowed(token)
}

pub(super) fn insert_authorized_session(
    authorized_tokens: &Arc<Mutex<HashMap<String, AuthorizedSession>>>,
    token: String,
    permission: &str,
) {
    authorized_tokens.lock().insert(
        token,
        AuthorizedSession {
            last_seen: Instant::now(),
            permission: normalize_permission(permission).to_string(),
        },
    );
}

fn is_banned(auth_attempts: &Arc<Mutex<HashMap<String, AuthAttemptState>>>, peer_ip: &str) -> bool {
    let mut attempts = auth_attempts.lock();
    let Some(state) = attempts.get(peer_ip) else {
        return false;
    };
    if let Some(until) = state.banned_until {
        if Instant::now() < until {
            return true;
        }
    }
    attempts.remove(peer_ip);
    false
}

fn record_auth_failure(
    auth_attempts: &Arc<Mutex<HashMap<String, AuthAttemptState>>>,
    peer_ip: &str,
) {
    let mut attempts = auth_attempts.lock();
    let state = attempts
        .entry(peer_ip.to_string())
        .or_insert(AuthAttemptState {
            failures: 0,
            banned_until: None,
        });
    state.failures = state.failures.saturating_add(1);
    if state.failures >= MAX_AUTH_FAILURES {
        state.banned_until = Some(Instant::now() + AUTH_BAN_DURATION);
    }
}

pub(super) fn normalize_permission(permission: &str) -> &str {
    match permission {
        "readOnly" => "readOnly",
        "uploadOnly" => "uploadOnly",
        _ => "readWrite",
    }
}

pub(super) fn can_read(permission: &str) -> bool {
    matches!(normalize_permission(permission), "readOnly" | "readWrite")
}

pub(super) fn can_upload(permission: &str) -> bool {
    matches!(normalize_permission(permission), "uploadOnly" | "readWrite")
}

pub(super) fn prune_devices(devices: &Arc<Mutex<HashMap<String, LanConnectedDevice>>>) {
    let cutoff = now_ms().saturating_sub(30 * 60 * 1000);
    devices
        .lock()
        .retain(|_, device| device.last_seen >= cutoff);
}

pub(super) fn touch_device_from_request(
    devices: &Arc<Mutex<HashMap<String, LanConnectedDevice>>>,
    request: &str,
    security_mode: &str,
    peer_ip: &str,
    permission: &str,
    operation: &str,
) {
    if let Some(id) = session_id_from_request(request, security_mode, peer_ip) {
        touch_device(
            devices,
            id,
            peer_ip,
            permission,
            &client_name_from_request(request),
            operation,
        );
    }
}

pub(super) fn touch_device(
    devices: &Arc<Mutex<HashMap<String, LanConnectedDevice>>>,
    id: String,
    peer_ip: &str,
    permission: &str,
    device_name: &str,
    operation: &str,
) {
    let now = now_ms();
    let mut devices = devices.lock();
    let entry = devices
        .entry(id.clone())
        .or_insert_with(|| LanConnectedDevice {
            id,
            ip: peer_ip.to_string(),
            device_name: device_name.to_string(),
            permission: normalize_permission(permission).to_string(),
            connected_at: now,
            last_seen: now,
            current_operation: operation.to_string(),
        });
    entry.ip = peer_ip.to_string();
    entry.device_name = device_name.to_string();
    entry.permission = normalize_permission(permission).to_string();
    entry.last_seen = now;
    entry.current_operation = operation.to_string();
}

pub(super) fn session_id_from_request(
    request: &str,
    security_mode: &str,
    peer_ip: &str,
) -> Option<String> {
    if security_mode == "open" {
        return Some(format!("open:{peer_ip}"));
    }
    cookie_token(request)
        .or_else(|| (security_mode == "trusted").then(|| format!("trusted:{peer_ip}")))
}

fn cookie_token(request: &str) -> Option<String> {
    let cookie_line = request
        .lines()
        .find(|line| line.to_ascii_lowercase().starts_with("cookie:"))?;
    let cookie = cookie_line
        .split_once(':')
        .map(|(_, value)| value)
        .unwrap_or("");
    cookie.split(';').find_map(|part| {
        let (key, value) = part.trim().split_once('=')?;
        (key == "mftp_token").then(|| value.to_string())
    })
}

pub(super) fn client_name_from_request(request: &str) -> String {
    let user_agent = request
        .lines()
        .find_map(|line| {
            let (key, value) = line.split_once(':')?;
            key.eq_ignore_ascii_case("user-agent")
                .then(|| value.trim().to_string())
        })
        .unwrap_or_default();
    if user_agent.is_empty() {
        return "浏览器".to_string();
    }
    let browser = if user_agent.contains("Edg/") {
        "Edge"
    } else if user_agent.contains("Firefox/") {
        "Firefox"
    } else if user_agent.contains("Chrome/") || user_agent.contains("Chromium/") {
        "Chrome"
    } else if user_agent.contains("Safari/") {
        "Safari"
    } else {
        "浏览器"
    };
    let os = if user_agent.contains("Windows") {
        "Windows"
    } else if user_agent.contains("Mac OS X") || user_agent.contains("Macintosh") {
        "macOS"
    } else if user_agent.contains("Android") {
        "Android"
    } else if user_agent.contains("iPhone") || user_agent.contains("iPad") {
        "iOS"
    } else if user_agent.contains("Linux") {
        "Linux"
    } else {
        ""
    };
    if os.is_empty() {
        browser.to_string()
    } else {
        format!("{browser} / {os}")
    }
}

pub(super) fn is_lan_ipv4(ip: Ipv4Addr) -> bool {
    ip.is_loopback()
        || ip.is_private()
        || ip.is_link_local()
        || (ip.octets()[0] == 100 && (64..=127).contains(&ip.octets()[1]))
}

pub(super) fn is_allowed_peer_ip(peer_ip: &str) -> bool {
    let Ok(ip) = peer_ip.parse::<IpAddr>() else {
        return false;
    };
    match ip {
        IpAddr::V4(ip) => is_lan_ipv4(ip),
        IpAddr::V6(ip) => ip.is_loopback() || ip.is_unique_local() || ip.is_unicast_link_local(),
    }
}

pub(super) fn is_authorized(
    request: &str,
    security_mode: &str,
    authorized_tokens: &Arc<Mutex<HashMap<String, AuthorizedSession>>>,
    trusted_ips: &[String],
    peer_ip: &str,
) -> bool {
    if security_mode == "open" {
        return true;
    }
    if security_mode == "trusted" && trusted_ips.iter().any(|ip| ip == peer_ip) {
        return true;
    }
    effective_permission(
        request,
        security_mode,
        authorized_tokens,
        trusted_ips,
        peer_ip,
    )
    .is_some()
}

pub(super) fn effective_permission(
    request: &str,
    security_mode: &str,
    authorized_tokens: &Arc<Mutex<HashMap<String, AuthorizedSession>>>,
    trusted_ips: &[String],
    peer_ip: &str,
) -> Option<String> {
    if security_mode == "open"
        || (security_mode == "trusted" && trusted_ips.iter().any(|ip| ip == peer_ip))
    {
        return None;
    }
    let token = cookie_token(request);
    let Some(token) = token else {
        return None;
    };
    let mut tokens = authorized_tokens.lock();
    let Some(session) = tokens.get_mut(&token) else {
        return None;
    };
    if Instant::now().duration_since(session.last_seen) > SESSION_TIMEOUT {
        tokens.remove(&token);
        return None;
    }
    session.last_seen = Instant::now();
    Some(normalize_permission(&session.permission).to_string())
}

pub(super) fn current_permission(
    request: &str,
    security_mode: &str,
    default_permission: &str,
    trusted_ips: &[String],
    authorized_tokens: &Arc<Mutex<HashMap<String, AuthorizedSession>>>,
    peer_ip: &str,
) -> String {
    effective_permission(
        request,
        security_mode,
        authorized_tokens,
        trusted_ips,
        peer_ip,
    )
    .unwrap_or_else(|| normalize_permission(default_permission).to_string())
}

pub(super) fn create_or_touch_auth_request(
    pending: &Arc<Mutex<HashMap<String, PendingAuthRequest>>>,
    peer_ip: &str,
    device_name: &str,
    access_type: &str,
) -> String {
    prune_auth_requests(pending);
    let mut pending = pending.lock();
    if let Some(request) = pending.values_mut().find(|request| {
        request.ip == peer_ip && matches!(request.status, PendingAuthStatus::Pending)
    }) {
        request.device_name = device_name.to_string();
        request.access_type = access_type.to_string();
        request.requested_at = now_ms();
        return request.id.clone();
    }
    let id = uuid::Uuid::new_v4().to_string();
    pending.insert(
        id.clone(),
        PendingAuthRequest {
            id: id.clone(),
            ip: peer_ip.to_string(),
            device_name: device_name.to_string(),
            access_type: access_type.to_string(),
            requested_at: now_ms(),
            status: PendingAuthStatus::Pending,
        },
    );
    id
}

pub(super) fn list_pending_auth_requests(
    pending: &Arc<Mutex<HashMap<String, PendingAuthRequest>>>,
) -> Vec<LanAuthRequest> {
    prune_auth_requests(pending);
    let mut requests = pending
        .lock()
        .values()
        .filter(|request| matches!(request.status, PendingAuthStatus::Pending))
        .map(|request| LanAuthRequest {
            id: request.id.clone(),
            ip: request.ip.clone(),
            device_name: request.device_name.clone(),
            access_type: request.access_type.clone(),
            requested_at: request.requested_at,
        })
        .collect::<Vec<_>>();
    requests.sort_by_key(|request| std::cmp::Reverse(request.requested_at));
    requests
}

pub(super) fn resolve_auth_request(
    pending: &Arc<Mutex<HashMap<String, PendingAuthRequest>>>,
    authorized_tokens: &Arc<Mutex<HashMap<String, AuthorizedSession>>>,
    id: &str,
    allowed: bool,
    permission: &str,
) -> bool {
    let mut pending = pending.lock();
    let Some(request) = pending.get_mut(id) else {
        return false;
    };
    if !matches!(request.status, PendingAuthStatus::Pending) {
        return false;
    }
    if allowed {
        let token = uuid::Uuid::new_v4().to_string();
        insert_authorized_session(authorized_tokens, token.clone(), permission);
        request.status = PendingAuthStatus::Approved {
            token,
            permission: normalize_permission(permission).to_string(),
        };
    } else {
        request.status = PendingAuthStatus::Rejected;
    }
    true
}

pub(super) fn auth_decision_json(
    pending: &Arc<Mutex<HashMap<String, PendingAuthRequest>>>,
    id: &str,
) -> (String, Option<(String, String)>) {
    prune_auth_requests(pending);
    let pending = pending.lock();
    let Some(request) = pending.get(id) else {
        return (r#"{"status":"expired"}"#.to_string(), None);
    };
    match &request.status {
        PendingAuthStatus::Pending => (r#"{"status":"pending"}"#.to_string(), None),
        PendingAuthStatus::Rejected => (r#"{"status":"rejected"}"#.to_string(), None),
        PendingAuthStatus::Approved { token, permission } => (
            format!(r#"{{"status":"approved","permission":"{permission}"}}"#),
            Some((token.clone(), permission.clone())),
        ),
    }
}

pub(super) fn prune_auth_requests(pending: &Arc<Mutex<HashMap<String, PendingAuthRequest>>>) {
    let cutoff = now_ms().saturating_sub(10 * 60 * 1000);
    pending
        .lock()
        .retain(|_, request| request.requested_at >= cutoff);
}

pub(super) fn generate_code() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);
    format!("{:06}", (millis % 900_000) + 100_000)
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}
