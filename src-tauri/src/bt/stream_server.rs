//! Local Range server backed directly by librqbit's task stream.

use std::sync::Arc;
use std::time::Duration;

use librqbit::Session;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::time::timeout;

use crate::storage::Storage;

const MAX_HEADER_BYTES: usize = 8 * 1024;
const READ_BUFFER: usize = 64 * 1024;
const READY_TIMEOUT: Duration = Duration::from_secs(30);
const READ_STALL_TIMEOUT: Duration = Duration::from_secs(90);

pub(super) struct StreamServer {
    port: u16,
    token: String,
    pub(super) accept_task: tokio::task::JoinHandle<()>,
}

impl StreamServer {
    pub(super) async fn spawn(session: Arc<Session>, storage: Storage) -> Option<Self> {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.ok()?;
        let port = listener.local_addr().ok()?.port();
        let token = uuid::Uuid::new_v4().to_string();
        let accept_task = tokio::spawn(accept_loop(listener, session, storage, token.clone()));
        Some(Self {
            port,
            token,
            accept_task,
        })
    }

    pub(super) fn url_for(&self, info_hash: &str, file_index: usize) -> String {
        format!(
            "http://127.0.0.1:{}/{}/stream/{}/{}",
            self.port, self.token, info_hash, file_index
        )
    }
}

async fn accept_loop(
    listener: TcpListener,
    session: Arc<Session>,
    storage: Storage,
    token: String,
) {
    loop {
        let Ok((stream, _)) = listener.accept().await else {
            continue;
        };
        tokio::spawn(handle_connection(
            stream,
            session.clone(),
            storage.clone(),
            token.clone(),
        ));
    }
}

struct Request {
    path: String,
    range: Option<(u64, Option<u64>)>,
}

async fn handle_connection(
    mut stream: TcpStream,
    session: Arc<Session>,
    storage: Storage,
    token: String,
) {
    let Ok(Some(request)) = read_request(&mut stream).await else {
        return;
    };
    let prefix = format!("/{token}/stream/");
    let Some(route) = request.path.strip_prefix(&prefix) else {
        let _ = write_simple(&mut stream, 404, "Not Found").await;
        return;
    };
    let Some((hash_text, file_index)) = split_route(route) else {
        let _ = write_simple(&mut stream, 404, "Not Found").await;
        return;
    };
    let selected = storage
        .get_bt_task(&hash_text)
        .ok()
        .flatten()
        .is_some_and(|task| task.file_indices.contains(&file_index));
    if !selected {
        let _ = write_simple(&mut stream, 404, "Not Found").await;
        return;
    }
    let Ok(hash) = super::parse_info_hash(&hash_text) else {
        let _ = write_simple(&mut stream, 404, "Not Found").await;
        return;
    };
    let Ok(Some(handle)) = super::find_handle(&session, &hash) else {
        let _ = write_simple(&mut stream, 404, "Not Found").await;
        return;
    };
    if !matches!(
        timeout(READY_TIMEOUT, handle.wait_until_initialized()).await,
        Ok(Ok(()))
    ) {
        let _ = write_simple(&mut stream, 503, "Torrent Not Ready").await;
        return;
    }
    respond_with_range(&mut stream, handle, file_index, request.range).await;
}

async fn read_request(stream: &mut TcpStream) -> std::io::Result<Option<Request>> {
    let mut bytes = Vec::with_capacity(1024);
    let mut chunk = [0u8; 512];
    loop {
        let read = stream.read(&mut chunk).await?;
        if read == 0 {
            return Ok(None);
        }
        bytes.extend_from_slice(&chunk[..read]);
        if bytes.len() > MAX_HEADER_BYTES {
            return Ok(None);
        }
        if let Some(end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
            return Ok(parse_request(&bytes[..end + 4]));
        }
    }
}

fn parse_request(raw: &[u8]) -> Option<Request> {
    let text = std::str::from_utf8(raw).ok()?;
    let mut lines = text.lines();
    let path = lines.next()?.split_whitespace().nth(1)?.to_string();
    let range = lines.find_map(|line| line.strip_prefix("Range:").and_then(parse_range));
    Some(Request { path, range })
}

fn parse_range(header: &str) -> Option<(u64, Option<u64>)> {
    let value = header.trim().strip_prefix("bytes=")?.split(',').next()?;
    let (start, end) = value.split_once('-')?;
    if start.trim().is_empty() {
        return Some((u64::MAX, Some(end.trim().parse().ok()?)));
    }
    Some((start.trim().parse().ok()?, end.trim().parse().ok()))
}

fn split_route(route: &str) -> Option<(String, usize)> {
    let (hash, index) = route.split_once('/')?;
    if hash.is_empty() || index.contains('/') {
        return None;
    }
    Some((hash.to_string(), index.parse().ok()?))
}

async fn write_simple(stream: &mut TcpStream, status: u16, reason: &str) -> std::io::Result<()> {
    stream
        .write_all(
            format!("HTTP/1.1 {status} {reason}\r\nContent-Length: 0\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n")
                .as_bytes(),
        )
        .await?;
    stream.shutdown().await
}

async fn respond_with_range(
    stream: &mut TcpStream,
    handle: super::TorrentHandle,
    file_index: usize,
    range: Option<(u64, Option<u64>)>,
) {
    let metadata = handle.with_metadata(|metadata| {
        metadata.file_infos.get(file_index).map(|file| {
            (
                file.len,
                file.relative_filename.to_string_lossy().into_owned(),
            )
        })
    });
    let Ok(Some((total, filename))) = metadata else {
        let _ = write_simple(stream, 404, "Not Found").await;
        return;
    };
    let Some((start, end, status)) = resolve_range(total, range) else {
        let _ = write_simple(stream, 416, "Range Not Satisfiable").await;
        return;
    };
    let length = end.saturating_sub(start).saturating_add(1);
    let content_type = mime_guess::from_path(&filename)
        .first_or_octet_stream()
        .to_string();
    let header = if status == 206 {
        format!(
            "HTTP/1.1 206 Partial Content\r\nContent-Type: {content_type}\r\nContent-Length: {length}\r\nContent-Range: bytes {start}-{end}/{total}\r\nAccept-Ranges: bytes\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n"
        )
    } else {
        format!(
            "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {length}\r\nAccept-Ranges: bytes\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n"
        )
    };
    if stream.write_all(header.as_bytes()).await.is_err() {
        return;
    }
    let Ok(mut source) = handle.stream(file_index).await else {
        return;
    };
    if source.seek(std::io::SeekFrom::Start(start)).await.is_err() {
        return;
    }
    let mut remaining = length;
    let mut buffer = vec![0u8; READ_BUFFER.min(length as usize).max(1)];
    while remaining > 0 {
        let want = buffer.len().min(remaining as usize);
        let read = timeout(READ_STALL_TIMEOUT, source.read(&mut buffer[..want])).await;
        match read {
            Ok(Ok(0)) | Err(_) => break,
            Ok(Ok(count)) => {
                if stream.write_all(&buffer[..count]).await.is_err() {
                    return;
                }
                remaining = remaining.saturating_sub(count as u64);
            }
            Ok(Err(_)) => return,
        }
    }
    let _ = stream.shutdown().await;
}

fn resolve_range(total: u64, range: Option<(u64, Option<u64>)>) -> Option<(u64, u64, u16)> {
    if total == 0 {
        return None;
    }
    match range {
        None => Some((0, total - 1, 200)),
        Some((u64::MAX, Some(suffix))) if suffix > 0 => {
            let length = suffix.min(total);
            Some((total - length, total - 1, 206))
        }
        Some((start, end)) if start < total && end.is_none_or(|value| value >= start) => {
            Some((start, end.unwrap_or(total - 1).min(total - 1), 206))
        }
        _ => None,
    }
}

#[cfg(test)]
#[path = "stream_server_tests.rs"]
mod tests;
