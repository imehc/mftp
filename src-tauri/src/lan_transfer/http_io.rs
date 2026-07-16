use crate::models::LanTransferTask;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom, Write};
use std::net::TcpStream;
use std::sync::Arc;

pub(super) fn write_response(
    stream: &mut TcpStream,
    status: &str,
    content_type: &str,
    body: &[u8],
) -> std::io::Result<()> {
    write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    )?;
    stream.write_all(body)
}

pub(super) fn write_file_range_response(
    stream: &mut TcpStream,
    status: &str,
    content_type: &str,
    file: &mut std::fs::File,
    range: (u64, u64),
    content_length: u64,
    headers: &[String],
    tasks: &Arc<Mutex<HashMap<String, LanTransferTask>>>,
    task_id: &str,
) -> std::io::Result<()> {
    let (start, end) = range;
    let range_len = if content_length == 0 {
        0
    } else {
        end.saturating_sub(start).saturating_add(1)
    };
    if status.starts_with("206") {
        write!(
            stream,
            "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {range_len}\r\nAccept-Ranges: bytes\r\nContent-Range: bytes {start}-{end}/{content_length}\r\n",
        )?;
    } else {
        write!(
            stream,
            "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {range_len}\r\nAccept-Ranges: bytes\r\n",
        )?;
    }
    for header in headers {
        stream.write_all(header.as_bytes())?;
    }
    stream.write_all(b"Connection: close\r\n\r\n")?;
    file.seek(SeekFrom::Start(start))?;
    let mut sent = 0u64;
    let mut buffer = [0u8; 64 * 1024];
    while sent < range_len {
        if super::tasks::task_is_canceled(tasks, task_id) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::Interrupted,
                "transfer canceled",
            ));
        }
        let remaining = (range_len - sent) as usize;
        let max_read = buffer.len().min(remaining);
        let n = file.read(&mut buffer[..max_read])?;
        if n == 0 {
            break;
        }
        stream.write_all(&buffer[..n])?;
        sent = sent.saturating_add(n as u64);
        super::tasks::update_task_progress(tasks, task_id, sent, "running");
    }
    Ok(())
}

pub(super) fn parse_range_header(request: &str, total: u64) -> Option<(u64, u64)> {
    if total == 0 {
        return Some((0, 0));
    }
    let header = request.lines().find_map(|line| {
        let (key, value) = line.split_once(':')?;
        key.eq_ignore_ascii_case("range")
            .then(|| value.trim().to_string())
    })?;
    let range = header.strip_prefix("bytes=")?;
    let (start, end) = range.split_once('-')?;
    let start = if start.is_empty() {
        let suffix = end.parse::<u64>().ok()?;
        total.saturating_sub(suffix)
    } else {
        start.parse::<u64>().ok()?
    };
    let end = if end.is_empty() {
        total.saturating_sub(1)
    } else {
        end.parse::<u64>().ok()?.min(total.saturating_sub(1))
    };
    (start <= end && start < total).then_some((start, end))
}

pub(super) fn write_response_with_headers(
    stream: &mut TcpStream,
    status: &str,
    content_type: &str,
    headers: &[String],
    body: &[u8],
) -> std::io::Result<()> {
    write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n",
        body.len()
    )?;
    for header in headers {
        stream.write_all(header.as_bytes())?;
    }
    stream.write_all(b"\r\n")?;
    stream.write_all(body)
}

pub(super) fn write_head_response(
    stream: &mut TcpStream,
    status: &str,
    content_type: &str,
    content_length: u64,
    headers: &[String],
) -> std::io::Result<()> {
    write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {content_length}\r\nAccept-Ranges: bytes\r\nConnection: close\r\n",
    )?;
    for header in headers {
        stream.write_all(header.as_bytes())?;
    }
    stream.write_all(b"\r\n")
}

pub(super) fn reject_transfer_limit(stream: &mut TcpStream, max_concurrent_transfers: usize) {
    let body = format!(
        "当前传输任务已达到上限（{}），请稍后重试",
        max_concurrent_transfers.max(1)
    );
    let _ = write_response(
        stream,
        "429 Too Many Requests",
        "text/plain; charset=utf-8",
        body.as_bytes(),
    );
}
