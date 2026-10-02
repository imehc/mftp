use super::tasks::SharedTasks;
use crate::core::http_range::parse_request_range;
use crate::error::AppError;
use crate::modules::lan_transfer::{LanConnectedDevice, LanSharedDir, LanTransferTask};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::net::TcpStream;
use std::path::Path;
use std::sync::Arc;

use super::auth::{
    can_read, effective_permission, is_authorized, normalize_permission, touch_device_from_request,
    AuthorizedSession,
};
use super::file_ops::resolve_request_path;
use super::http_io::{
    reject_transfer_limit, write_file_range_response, write_head_response, write_response,
    write_response_with_headers,
};
use super::logging::{
    record_access, record_access_error, record_transfer_failure, record_transfer_history,
};
use super::now_ms;
use super::tasks::{finish_task, start_task, try_acquire_transfer};

pub(super) struct DownloadContext<'a> {
    pub request: &'a str,
    pub first_line: &'a str,
    pub peer_ip: &'a str,
    pub shares: &'a [LanSharedDir],
    pub security_mode: &'a str,
    pub default_permission: &'a str,
    pub trusted_ips: &'a [String],
    pub authorized_tokens: &'a Arc<Mutex<HashMap<String, AuthorizedSession>>>,
    pub devices: &'a Arc<Mutex<HashMap<String, LanConnectedDevice>>>,
    pub tasks: &'a SharedTasks,
    pub active_transfers: &'a Arc<Mutex<usize>>,
    pub max_concurrent_transfers: usize,
    pub db_path: &'a Path,
}

pub(super) fn handle_download(stream: &mut TcpStream, ctx: DownloadContext<'_>) {
    if !is_authorized(
        ctx.request,
        ctx.security_mode,
        ctx.authorized_tokens,
        ctx.trusted_ips,
        ctx.peer_ip,
    ) {
        record_access(
            ctx.db_path,
            ctx.peer_ip,
            "download",
            "denied",
            Some("unauthorized"),
        );
        let _ = write_response(stream, "403 Forbidden", "text/plain", b"Unauthorized");
        return;
    }
    let permission = current_permission(&ctx);
    if !can_read(&permission) {
        record_access(
            ctx.db_path,
            ctx.peer_ip,
            "download",
            "denied",
            Some("permission"),
        );
        let _ = write_response(stream, "403 Forbidden", "text/plain", b"Forbidden");
        return;
    }
    touch_device_from_request(
        ctx.devices,
        ctx.request,
        ctx.security_mode,
        ctx.peer_ip,
        &permission,
        "download",
    );
    match resolve_request_path(ctx.first_line, ctx.shares) {
        Ok(path) if path.is_file() => {
            let Some(_permit) =
                try_acquire_transfer(ctx.active_transfers, ctx.max_concurrent_transfers)
            else {
                record_access(
                    ctx.db_path,
                    ctx.peer_ip,
                    "download",
                    "denied",
                    Some("transfer limit"),
                );
                reject_transfer_limit(stream, ctx.max_concurrent_transfers);
                return;
            };
            let file_name = path
                .file_name()
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or_else(|| path.to_string_lossy().to_string());
            // Registration outlives the file even if a worker unwinds.
            let _connection;
            match std::fs::File::open(&path).and_then(|file| {
                let total = file.metadata()?.len();
                Ok((file, total, stream.try_clone()?))
            }) {
                Ok((mut file, total, connection)) => {
                    let Some(range) = parse_request_range(ctx.request).resolve(total) else {
                        let _ = write_response_with_headers(
                            stream,
                            "416 Range Not Satisfiable",
                            "application/octet-stream",
                            &[
                                format!("Content-Range: bytes */{total}\r\n"),
                                "Accept-Ranges: bytes\r\n".into(),
                            ],
                            b"",
                        );
                        return;
                    };
                    let range_total = range.length;
                    let task_id = uuid::Uuid::new_v4().to_string();
                    _connection = start_task(
                        ctx.tasks,
                        LanTransferTask {
                            id: task_id.clone(),
                            direction: "download".to_string(),
                            file_name: file_name.clone(),
                            ip: ctx.peer_ip.to_string(),
                            status: "running".to_string(),
                            transferred: 0,
                            total: range_total,
                            started_at: now_ms(),
                            updated_at: now_ms(),
                            error: None,
                        },
                        Some(connection),
                    );
                    let result = write_file_range_response(
                        stream,
                        "application/octet-stream",
                        &mut file,
                        range,
                        total,
                        &[format!(
                            "Content-Disposition: attachment; filename*=UTF-8''{}\r\n",
                            percent_encode(&file_name)
                        )],
                        ctx.tasks,
                        &task_id,
                    );
                    drop(file);
                    match finish_task(ctx.tasks, &task_id, result) {
                        Ok(()) => {
                            record_access(
                                ctx.db_path,
                                ctx.peer_ip,
                                "download",
                                "success",
                                Some(&file_name),
                            );
                            record_transfer_history(
                                ctx.db_path,
                                ctx.peer_ip,
                                "download",
                                &file_name,
                                "success",
                            );
                        }
                        Err(error) => {
                            // Completion and cancellation are resolved under the task lock.
                            record_access_error(
                                ctx.db_path,
                                ctx.peer_ip,
                                "download",
                                &error,
                                Some(&file_name),
                            );
                            record_transfer_failure(
                                ctx.db_path,
                                ctx.peer_ip,
                                "download",
                                &file_name,
                                &error,
                            );
                        }
                    }
                }
                Err(error) => {
                    let error = AppError::from(error);
                    record_access_error(
                        ctx.db_path,
                        ctx.peer_ip,
                        "download",
                        &error,
                        Some(&file_name),
                    );
                    record_transfer_failure(
                        ctx.db_path,
                        ctx.peer_ip,
                        "download",
                        &file_name,
                        &error,
                    );
                    let _ = super::http_error::write_error(stream, &error);
                }
            }
        }
        Ok(_) => {
            record_access(
                ctx.db_path,
                ctx.peer_ip,
                "download",
                "failed",
                Some("not found"),
            );
            let _ = write_response(stream, "404 Not Found", "text/plain", b"Not found");
        }
        Err(error) => {
            record_access_error(ctx.db_path, ctx.peer_ip, "download", &error, None);
            let _ = super::http_error::write_error(stream, &error);
        }
    }
}

pub(super) fn handle_download_head(stream: &mut TcpStream, ctx: DownloadContext<'_>) {
    if !is_authorized(
        ctx.request,
        ctx.security_mode,
        ctx.authorized_tokens,
        ctx.trusted_ips,
        ctx.peer_ip,
    ) {
        record_access(
            ctx.db_path,
            ctx.peer_ip,
            "download_head",
            "denied",
            Some("unauthorized"),
        );
        let _ = write_response(stream, "403 Forbidden", "text/plain", b"Unauthorized");
        return;
    }
    let permission = current_permission(&ctx);
    if !can_read(&permission) {
        record_access(
            ctx.db_path,
            ctx.peer_ip,
            "download_head",
            "denied",
            Some("permission"),
        );
        let _ = write_response(stream, "403 Forbidden", "text/plain", b"Forbidden");
        return;
    }
    match resolve_request_path(ctx.first_line, ctx.shares) {
        Ok(path) if path.is_file() => {
            let file_name = path
                .file_name()
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or_else(|| path.to_string_lossy().to_string());
            match path.metadata() {
                Ok(meta) => {
                    touch_device_from_request(
                        ctx.devices,
                        ctx.request,
                        ctx.security_mode,
                        ctx.peer_ip,
                        &permission,
                        "download_head",
                    );
                    let headers = [
                        format!("X-Mftp-File-Name: {}\r\n", percent_encode(&file_name)),
                        format!(
                            "Content-Disposition: attachment; filename*=UTF-8''{}\r\n",
                            percent_encode(&file_name)
                        ),
                    ];
                    let _ = write_head_response(
                        stream,
                        "200 OK",
                        "application/octet-stream",
                        meta.len(),
                        &headers,
                    );
                }
                Err(error) => {
                    let error = AppError::from(error);
                    record_access_error(ctx.db_path, ctx.peer_ip, "download_head", &error, None);
                    let _ = super::http_error::write_error(stream, &error);
                }
            }
        }
        Ok(_) => {
            let _ = write_response(stream, "404 Not Found", "text/plain", b"Not found");
        }
        Err(error) => {
            record_access_error(ctx.db_path, ctx.peer_ip, "download_head", &error, None);
            let _ = super::http_error::write_error(stream, &error);
        }
    }
}

fn percent_encode(value: &str) -> String {
    value
        .as_bytes()
        .iter()
        .map(|byte| match *byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'.' | b'-' | b'_' => {
                (*byte as char).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

fn current_permission(ctx: &DownloadContext<'_>) -> String {
    effective_permission(
        ctx.request,
        ctx.security_mode,
        ctx.authorized_tokens,
        ctx.trusted_ips,
        ctx.peer_ip,
    )
    .unwrap_or_else(|| normalize_permission(ctx.default_permission).to_string())
}

#[cfg(test)]
#[path = "download_handlers_tests.rs"]
mod tests;
