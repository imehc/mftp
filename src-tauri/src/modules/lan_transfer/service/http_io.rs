use super::tasks::SharedTasks;
use super::transfer_io::copy_body;
use crate::core::http_range::ResolvedRange;
use std::io::{Read, Seek, SeekFrom, Write};
use std::net::TcpStream;

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
    stream: &mut impl Write,
    content_type: &str,
    file: &mut (impl Read + Seek),
    range: ResolvedRange,
    content_length: u64,
    headers: &[String],
    tasks: &SharedTasks,
    task_id: &str,
) -> std::io::Result<()> {
    let start = range.start;
    let end = range.end();
    let range_len = range.length;
    if range.partial {
        write!(
            stream,
            "HTTP/1.1 206 Partial Content\r\nContent-Type: {content_type}\r\nContent-Length: {range_len}\r\nAccept-Ranges: bytes\r\nContent-Range: bytes {start}-{end}/{content_length}\r\n",
        )?;
    } else {
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {range_len}\r\nAccept-Ranges: bytes\r\n",
        )?;
    }
    for header in headers {
        stream.write_all(header.as_bytes())?;
    }
    stream.write_all(b"Connection: close\r\n\r\n")?;
    file.seek(SeekFrom::Start(start))?;
    copy_body(file, stream, range_len, tasks, task_id)
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
    let error =
        crate::error::AppError::custom(crate::error::CustomErrorCode::LanTransferLimitReached)
            .with_arg("maxConcurrentTransfers", max_concurrent_transfers.max(1));
    let _ = super::http_error::write_error(stream, &error);
}

#[cfg(test)]
#[path = "http_io_tests.rs"]
mod tests;
