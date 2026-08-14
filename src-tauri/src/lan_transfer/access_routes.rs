use std::net::TcpStream;

use super::auth::{
    auth_decision_json, authorize, can_read, can_upload, client_name_from_request,
    create_or_touch_auth_request, current_permission, is_authorized, normalize_permission,
    touch_device, touch_device_from_request, AuthorizeOutcome,
};
use super::escape_json;
use super::file_ops::request_query_param;
use super::http_io::{write_response, write_response_with_headers};
use super::logging::record_access;
use super::server::ServerContext;

pub(super) fn handle(
    stream: &mut TcpStream,
    request: &str,
    first_line: &str,
    peer_ip: &str,
    context: &ServerContext,
) -> bool {
    if first_line.starts_with("GET /api/status ") {
        let authorized = is_authorized(
            request,
            &context.security_mode,
            &context.authorized_tokens,
            &context.trusted_ips,
            peer_ip,
        );
        let permission = current_permission(
            request,
            &context.security_mode,
            &context.default_permission,
            &context.trusted_ips,
            &context.authorized_tokens,
            peer_ip,
        );
        if authorized {
            touch_device_from_request(
                &context.devices,
                request,
                &context.security_mode,
                peer_ip,
                &permission,
                "status",
            );
        }
        let body = format!(
            r#"{{"deviceName":"{}","status":"running","authorized":{},"authMode":"{}","permission":"{}","canRead":{},"canUpload":{}}}"#,
            escape_json(&context.device_name),
            authorized,
            escape_json(&context.security_mode),
            escape_json(normalize_permission(&permission)),
            can_read(&permission),
            can_upload(&permission)
        );
        let _ = write_response(
            stream,
            "200 OK",
            "application/json; charset=utf-8",
            body.as_bytes(),
        );
        return true;
    }

    if first_line.starts_with("POST /api/authorize?") {
        match authorize(
            first_line,
            context.confirmation_code.as_deref(),
            &context.authorized_tokens,
            &context.auth_attempts,
            peer_ip,
            &context.default_permission,
        ) {
            AuthorizeOutcome::Allowed(token) => {
                touch_device(
                    &context.devices,
                    token.clone(),
                    peer_ip,
                    &context.default_permission,
                    &client_name_from_request(request),
                    "authorized",
                );
                record_access(&context.db_path, peer_ip, "authorize", "success", None);
                let header = format!("Set-Cookie: mftp_token={token}; Path=/; SameSite=Lax\r\n");
                let _ = write_response_with_headers(
                    stream,
                    "200 OK",
                    "application/json; charset=utf-8",
                    &[header],
                    br#"{"ok":true}"#,
                );
            }
            AuthorizeOutcome::Denied => {
                record_access(
                    &context.db_path,
                    peer_ip,
                    "authorize",
                    "denied",
                    Some("bad code"),
                );
                let _ = write_response(
                    stream,
                    "403 Forbidden",
                    "application/json; charset=utf-8",
                    br#"{"ok":false}"#,
                );
            }
            AuthorizeOutcome::Banned => {
                record_access(
                    &context.db_path,
                    peer_ip,
                    "authorize",
                    "blocked",
                    Some("too many attempts"),
                );
                let _ = write_response(
                    stream,
                    "429 Too Many Requests",
                    "application/json; charset=utf-8",
                    br#"{"ok":false,"banned":true}"#,
                );
            }
        }
        return true;
    }

    if first_line.starts_with("POST /api/request-access?") {
        if !matches!(context.security_mode.as_str(), "confirm" | "trusted") {
            let _ = write_response(
                stream,
                "400 Bad Request",
                "application/json",
                br#"{"error":"unsupported"}"#,
            );
            return true;
        }
        let access_type =
            request_query_param(first_line, "type").unwrap_or_else(|| "browser".to_string());
        let id = create_or_touch_auth_request(
            &context.pending_auth,
            peer_ip,
            &client_name_from_request(request),
            &access_type,
        );
        record_access(
            &context.db_path,
            peer_ip,
            "authorize_request",
            "pending",
            Some(&id),
        );
        let body = format!(r#"{{"id":"{}","status":"pending"}}"#, escape_json(&id));
        let _ = write_response(
            stream,
            "200 OK",
            "application/json; charset=utf-8",
            body.as_bytes(),
        );
        return true;
    }

    if first_line.starts_with("GET /api/access-decision?") {
        let Some(id) = request_query_param(first_line, "id") else {
            let _ = write_response(
                stream,
                "400 Bad Request",
                "application/json",
                br#"{"error":"missing id"}"#,
            );
            return true;
        };
        let (body, token) = auth_decision_json(&context.pending_auth, &id);
        if let Some((token, permission)) = token {
            touch_device(
                &context.devices,
                token.clone(),
                peer_ip,
                &permission,
                &client_name_from_request(request),
                "authorized",
            );
            record_access(
                &context.db_path,
                peer_ip,
                "authorize",
                "success",
                Some("confirm"),
            );
            let header = format!("Set-Cookie: mftp_token={token}; Path=/; SameSite=Lax\r\n");
            let _ = write_response_with_headers(
                stream,
                "200 OK",
                "application/json; charset=utf-8",
                &[header],
                body.as_bytes(),
            );
        } else {
            let _ = write_response(
                stream,
                "200 OK",
                "application/json; charset=utf-8",
                body.as_bytes(),
            );
        }
        return true;
    }
    false
}
