use std::net::TcpStream;

use super::auth::{can_upload, current_permission, is_authorized, touch_device_from_request};
use super::http_io::{reject_transfer_limit, write_response};
use super::logging::{
    record_access, record_access_error, record_transfer_failure, record_transfer_history,
};
use super::server::ServerContext;
use super::tasks::try_acquire_transfer;
use super::upload::{save_upload, upload_offset_json, upload_target_exists};

pub(super) fn handle(
    stream: &mut TcpStream,
    request: &str,
    first_line: &str,
    peer_ip: &str,
    initial_bytes: &[u8],
    context: &ServerContext,
) -> bool {
    let is_query = first_line.starts_with("GET /api/upload-exists?")
        || first_line.starts_with("GET /api/upload-offset?");
    let is_upload = first_line.starts_with("POST /api/upload?");
    if !is_query && !is_upload {
        return false;
    }
    if !is_authorized(
        request,
        &context.security_mode,
        &context.authorized_tokens,
        &context.trusted_ips,
        peer_ip,
    ) {
        if is_upload {
            record_access(
                &context.db_path,
                peer_ip,
                "upload",
                "denied",
                Some("unauthorized"),
            );
        }
        let _ = write_response(
            stream,
            "403 Forbidden",
            if is_upload {
                "text/plain"
            } else {
                "application/json"
            },
            if is_upload {
                b"Unauthorized"
            } else {
                br#"{"error":"unauthorized"}"#
            },
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
    if !can_upload(&permission) {
        if is_upload {
            record_access(
                &context.db_path,
                peer_ip,
                "upload",
                "denied",
                Some("permission"),
            );
        }
        let _ = write_response(
            stream,
            "403 Forbidden",
            if is_upload {
                "text/plain"
            } else {
                "application/json"
            },
            if is_upload {
                b"Forbidden"
            } else {
                br#"{"error":"permission"}"#
            },
        );
        return true;
    }
    if is_query {
        let result = if first_line.starts_with("GET /api/upload-offset?") {
            upload_offset_json(first_line, &context.download_dir)
        } else {
            upload_target_exists(first_line, &context.download_dir)
                .map(|exists| format!(r#"{{"exists":{exists}}}"#))
        };
        match result {
            Ok(body) => {
                let _ = write_response(
                    stream,
                    "200 OK",
                    "application/json; charset=utf-8",
                    body.as_bytes(),
                );
            }
            Err(error) => {
                let _ = super::http_error::write_error(stream, &error);
            }
        }
        return true;
    }
    touch_device_from_request(
        &context.devices,
        request,
        &context.security_mode,
        peer_ip,
        &permission,
        "upload",
    );
    let Some(_permit) =
        try_acquire_transfer(&context.active_transfers, context.max_concurrent_transfers)
    else {
        record_access(
            &context.db_path,
            peer_ip,
            "upload",
            "denied",
            Some("transfer limit"),
        );
        reject_transfer_limit(stream, context.max_concurrent_transfers);
        return true;
    };
    match save_upload(
        request,
        initial_bytes,
        stream,
        &context.download_dir,
        &context.tasks,
        peer_ip,
    ) {
        Ok(file_name) => {
            // Saving has completed before responding. A failed acknowledgement
            // must not append a second HTTP response or turn durable bytes into failure.
            let _ = write_response(stream, "200 OK", "application/json", br#"{"ok":true}"#);
            record_access(
                &context.db_path,
                peer_ip,
                "upload",
                "success",
                Some(&file_name),
            );
            record_transfer_history(&context.db_path, peer_ip, "upload", &file_name, "success");
        }
        Err(error) => {
            record_access_error(&context.db_path, peer_ip, "upload", &error, None);
            record_transfer_failure(&context.db_path, peer_ip, "upload", "-", &error);
            let _ = super::http_error::write_error(stream, &error);
        }
    }
    true
}
