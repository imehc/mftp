use std::net::TcpStream;

use super::auth::{can_read, current_permission, is_authorized, touch_device_from_request};
use super::file_ops::{browse_json, shares_json};
use super::http_io::write_response;
use super::logging::{record_access, record_access_error};
use super::server::ServerContext;

pub(super) fn handle(
    stream: &mut TcpStream,
    request: &str,
    first_line: &str,
    peer_ip: &str,
    context: &ServerContext,
) -> bool {
    let action = if first_line.starts_with("GET /api/shares ") {
        "shares"
    } else if first_line.starts_with("GET /api/browse?") {
        "browse"
    } else {
        return false;
    };
    if !is_authorized(
        request,
        &context.security_mode,
        &context.authorized_tokens,
        &context.trusted_ips,
        peer_ip,
    ) {
        record_access(
            &context.db_path,
            peer_ip,
            action,
            "denied",
            Some("unauthorized"),
        );
        let _ = write_response(
            stream,
            "403 Forbidden",
            "application/json",
            br#"{"error":"unauthorized"}"#,
        );
        return true;
    }
    let permission = current_permission(
        request,
        &context.security_mode,
        &context.default_permission,
        &context.trusted_ips,
        &context.authorized_tokens,
        peer_ip,
    );
    if !can_read(&permission) {
        record_access(
            &context.db_path,
            peer_ip,
            action,
            "denied",
            Some("permission"),
        );
        let _ = write_response(
            stream,
            "403 Forbidden",
            "application/json",
            br#"{"error":"permission"}"#,
        );
        return true;
    }
    touch_device_from_request(
        &context.devices,
        request,
        &context.security_mode,
        peer_ip,
        &permission,
        action,
    );
    let body = if action == "shares" {
        shares_json(&context.shares)
    } else {
        match browse_json(first_line, &context.shares) {
            Ok(body) => {
                record_access(&context.db_path, peer_ip, action, "success", None);
                let _ = write_response(
                    stream,
                    "200 OK",
                    "application/json; charset=utf-8",
                    body.as_bytes(),
                );
                return true;
            }
            Err(error) => {
                record_access_error(&context.db_path, peer_ip, action, &error, None);
                // Browse failures use the shared kind/code mapping instead of
                // masking every error as a 200 with an inline message.
                let _ = super::http_error::write_error_json(stream, &error);
                return true;
            }
        }
    };
    let _ = write_response(
        stream,
        "200 OK",
        "application/json; charset=utf-8",
        body.as_bytes(),
    );
    true
}
