use super::types::{AuthMaterial, AuthMethod};
use crate::error::{AppError, AppResult, CustomErrorCode};
use ssh2::{ErrorCode, Session};
use std::env;
use std::fs;
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::path::PathBuf;
use std::time::Duration;

pub(super) const SSH_OPERATION_TIMEOUT_MS: u32 = 30_000;
const SSH_CONNECT_TIMEOUT_SECS: u64 = 12;
const SFTP_KEEPALIVE_INTERVAL_SECS: u32 = 15;

/// Open + authenticate a blocking ssh2 session.
pub(super) fn connect(mat: &AuthMaterial) -> AppResult<Session> {
    let tcp = connect_tcp(&mat.host, mat.port)?;
    let mut sess = Session::new()?;
    sess.set_timeout(SSH_OPERATION_TIMEOUT_MS);
    sess.set_tcp_stream(tcp);
    sess.handshake()?;
    match &mat.method {
        AuthMethod::Password(Some(pw)) => {
            sess.userauth_password(&mat.username, pw)?;
        }
        AuthMethod::Password(None) => authenticate_with_local_defaults(&sess, mat)?,
        AuthMethod::Key {
            private_key,
            passphrase,
        } => {
            sess.userauth_pubkey_memory(&mat.username, None, private_key, passphrase.as_deref())?;
        }
    }
    if !sess.authenticated() {
        return Err(ssh2::Error::from_errno(ErrorCode::Session(-18)).into());
    }
    sess.set_keepalive(true, SFTP_KEEPALIVE_INTERVAL_SECS);
    Ok(sess)
}

fn authenticate_with_local_defaults(sess: &Session, mat: &AuthMaterial) -> AppResult<()> {
    let mut last_error = None;
    let mut attempts = 1;
    match sess.userauth_agent(&mat.username) {
        Ok(()) if sess.authenticated() => return Ok(()),
        Ok(()) => {}
        Err(error) => last_error = Some(AppError::from(error)),
    }
    for path in local_identity_candidates(&mat.identity_files) {
        if !path.exists() {
            continue;
        }
        attempts += 1;
        match sess.userauth_pubkey_file(&mat.username, None, &path, None) {
            Ok(()) if sess.authenticated() => return Ok(()),
            Ok(()) => {}
            Err(error) => last_error = Some(AppError::from(error)),
        }
    }
    // Preserve the last library failure without aggregating identity paths or
    // authentication inputs into the diagnostic sent across IPC.
    Err(last_error
        .unwrap_or_else(|| AppError::custom(CustomErrorCode::SshNoAuthMethod))
        .context("Authenticating with local SSH credentials")
        .with_arg("attempts", attempts))
}

fn connect_tcp(host: &str, port: u16) -> AppResult<TcpStream> {
    let host = host.trim();
    let context = |error: std::io::Error| {
        AppError::from(error)
            .with_arg("host", host)
            .with_arg("port", port)
    };
    let mut addrs: Vec<SocketAddr> = (host, port)
        .to_socket_addrs()
        .map_err(|error| context(error).context("Resolving SSH host"))?
        .collect();
    if host.eq_ignore_ascii_case("localhost") {
        addrs.sort_by_key(|addr| if addr.is_ipv4() { 0 } else { 1 });
    }
    let mut last_error = None;
    for addr in addrs {
        match TcpStream::connect_timeout(&addr, Duration::from_secs(SSH_CONNECT_TIMEOUT_SECS)) {
            Ok(tcp) => {
                let _ = tcp.set_nodelay(true);
                return Ok(tcp);
            }
            Err(error) => last_error = Some(error),
        }
    }
    let error = last_error.unwrap_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::AddrNotAvailable,
            "SSH host resolved to no addresses",
        )
    });
    Err(context(error).context("Connecting to SSH host"))
}

#[derive(Default)]
struct SshHostConfig {
    hostname: Option<String>,
    port: Option<u16>,
    user: Option<String>,
    identity_files: Vec<PathBuf>,
}

pub fn resolve_auth_material(mut mat: AuthMaterial) -> AppResult<AuthMaterial> {
    let original_host = mat.host.clone();
    if let Some(config) = read_ssh_config_for_host(&original_host) {
        if mat.username.trim().is_empty() {
            if let Some(user) = config.user {
                mat.username = expand_ssh_tokens(&user, &original_host, "");
            }
        }
        if let Some(hostname) = config.hostname {
            mat.host = expand_ssh_tokens(&hostname, &original_host, &mat.username);
        }
        if let Some(port) = config.port {
            mat.port = port;
        }
        mat.identity_files = config.identity_files;
    }

    if mat.username.trim().is_empty() {
        mat.username = local_username()?;
    }

    Ok(mat)
}

fn read_ssh_config_for_host(host: &str) -> Option<SshHostConfig> {
    let path = dirs::home_dir()?.join(".ssh/config");
    let raw = fs::read_to_string(path).ok()?;
    let mut config = SshHostConfig::default();
    let mut active = true;

    for raw_line in raw.lines() {
        let Some((key, value)) = parse_ssh_config_line(raw_line) else {
            continue;
        };
        let key = key.to_ascii_lowercase();
        if key == "host" {
            active = host_patterns_match(&value, host);
            continue;
        }
        if !active {
            continue;
        }

        match key.as_str() {
            "hostname" if config.hostname.is_none() => {
                config.hostname = Some(value);
            }
            "port" if config.port.is_none() => {
                config.port = value.parse::<u16>().ok();
            }
            "user" if config.user.is_none() => {
                config.user = Some(value);
            }
            "identityfile" => {
                let user = config.user.as_deref().unwrap_or("");
                config
                    .identity_files
                    .push(expand_identity_path(&value, host, user));
            }
            _ => {}
        }
    }

    Some(config)
}

fn parse_ssh_config_line(line: &str) -> Option<(String, String)> {
    let line = strip_ssh_comment(line).trim();
    if line.is_empty() {
        return None;
    }

    let first_ws = line.find(char::is_whitespace);
    let first_eq = line.find('=');
    let (key, value) = match (first_eq, first_ws) {
        (Some(eq), Some(ws)) if eq < ws => (&line[..eq], &line[eq + 1..]),
        (Some(eq), None) => (&line[..eq], &line[eq + 1..]),
        (_, Some(ws)) => (&line[..ws], &line[ws + 1..]),
        _ => return None,
    };

    Some((key.trim().to_string(), unquote_ssh_value(value.trim())))
}

fn strip_ssh_comment(line: &str) -> &str {
    let mut single = false;
    let mut double = false;
    for (idx, ch) in line.char_indices() {
        match ch {
            '\'' if !double => single = !single,
            '"' if !single => double = !double,
            '#' if !single && !double => return &line[..idx],
            _ => {}
        }
    }
    line
}

fn unquote_ssh_value(value: &str) -> String {
    if value.len() >= 2 {
        let bytes = value.as_bytes();
        if (bytes[0] == b'"' && bytes[value.len() - 1] == b'"')
            || (bytes[0] == b'\'' && bytes[value.len() - 1] == b'\'')
        {
            return value[1..value.len() - 1].to_string();
        }
    }
    value.to_string()
}

fn host_patterns_match(patterns: &str, host: &str) -> bool {
    let mut matched = false;
    for pattern in patterns.split_whitespace() {
        if let Some(negated) = pattern.strip_prefix('!') {
            if wildcard_match(negated, host) {
                return false;
            }
        } else if wildcard_match(pattern, host) {
            matched = true;
        }
    }
    matched
}

fn wildcard_match(pattern: &str, text: &str) -> bool {
    let pattern = pattern.to_ascii_lowercase();
    let text = text.to_ascii_lowercase();
    wildcard_match_bytes(pattern.as_bytes(), text.as_bytes())
}

fn wildcard_match_bytes(pattern: &[u8], text: &[u8]) -> bool {
    if pattern.is_empty() {
        return text.is_empty();
    }

    match pattern[0] {
        b'*' => {
            wildcard_match_bytes(&pattern[1..], text)
                || (!text.is_empty() && wildcard_match_bytes(pattern, &text[1..]))
        }
        b'?' => !text.is_empty() && wildcard_match_bytes(&pattern[1..], &text[1..]),
        ch => !text.is_empty() && ch == text[0] && wildcard_match_bytes(&pattern[1..], &text[1..]),
    }
}

fn expand_identity_path(value: &str, host: &str, user: &str) -> PathBuf {
    let expanded = expand_ssh_tokens(value, host, user);
    if let Some(home) = dirs::home_dir() {
        if expanded == "~" {
            return home;
        }
        if let Some(rest) = expanded.strip_prefix("~/") {
            return home.join(rest);
        }
    }
    PathBuf::from(expanded)
}

fn expand_ssh_tokens(value: &str, host: &str, user: &str) -> String {
    let local_user = local_username().unwrap_or_else(|_| String::new());
    let home = dirs::home_dir()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default();
    value
        .replace("%h", host)
        .replace("%n", host)
        .replace("%r", user)
        .replace("%u", &local_user)
        .replace("%d", &home)
}

fn local_username() -> AppResult<String> {
    env::var("USER")
        .or_else(|_| env::var("USERNAME"))
        .map_err(|_| AppError::custom(CustomErrorCode::SshUsernameUnavailable))
}

fn local_identity_candidates(configured: &[PathBuf]) -> Vec<PathBuf> {
    let mut paths = configured.to_vec();
    if let Some(home) = dirs::home_dir() {
        let ssh_dir = home.join(".ssh");
        for name in [
            "id_ed25519",
            "id_ecdsa",
            "id_ecdsa_sk",
            "id_ed25519_sk",
            "id_rsa",
            "id_dsa",
        ] {
            let path = ssh_dir.join(name);
            if !paths.iter().any(|item| item == &path) {
                paths.push(path);
            }
        }
    }
    paths
}
