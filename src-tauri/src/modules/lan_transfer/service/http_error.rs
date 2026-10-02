use super::http_io::write_response;
use crate::error::{AppError, AppErrorKind};
use std::net::TcpStream;

pub(super) fn status(error: &AppError) -> &'static str {
    use AppErrorKind::{Custom, External};
    match (error.kind, error.code.as_str()) {
        (Custom, "lan:request_headers_too_large") => "431 Request Header Fields Too Large",
        (Custom, "lan:transfer_limit_reached") => "429 Too Many Requests",
        (Custom, "lan:upload_space_insufficient") => "507 Insufficient Storage",
        (Custom, "lan:shared_dir_unavailable") => "503 Service Unavailable",
        (
            Custom,
            "lan:upload_offset_mismatch" | "lan:upload_target_busy" | "lan:transfer_cancelled",
        )
        | (External, "io:already_exists") => "409 Conflict",
        (
            Custom,
            "lan:request_invalid"
            | "lan:upload_invalid"
            | "lan:upload_name_invalid"
            | "lan:upload_target_invalid"
            | "lan:share_unknown"
            | "lan:shared_path_invalid",
        )
        | (External, "io:unexpected_eof") => "400 Bad Request",
        (External, "io:timed_out" | "io:would_block") => "408 Request Timeout",
        (External, "io:permission_denied") => "403 Forbidden",
        (External, "io:not_found") => "404 Not Found",
        _ => "500 Internal Server Error",
    }
}

// Diagnostics safe for the remote browser: custom messages are stable English
// summaries; external errors only expose the status text.
fn safe_body(error: &AppError) -> &str {
    if error.kind == AppErrorKind::Custom {
        return &error.message;
    }
    status(error)
}

// Only call before starting a response. File bodies must never contain errors
// after their headers; the local task retains the complete AppError instead.
pub(super) fn write_error(stream: &mut TcpStream, error: &AppError) -> std::io::Result<()> {
    let status = status(error);
    write_response(
        stream,
        status,
        "text/plain; charset=utf-8",
        safe_body(error).as_bytes(),
    )
}

// JSON API routes keep their `{"error": ...}` body contract with the browser
// client while the status now follows the kind/code mapping.
pub(super) fn write_error_json(stream: &mut TcpStream, error: &AppError) -> std::io::Result<()> {
    let status = status(error);
    let body = format!(r#"{{"error":"{}"}}"#, super::escape_json(safe_body(error)));
    write_response(
        stream,
        status,
        "application/json; charset=utf-8",
        body.as_bytes(),
    )
}

#[cfg(test)]
#[path = "http_error_tests.rs"]
mod tests;
