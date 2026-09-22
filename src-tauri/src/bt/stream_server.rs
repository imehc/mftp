//! Local Range server reading original files or verified torrent pieces, never a cache.

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use librqbit::Session;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncSeek, AsyncSeekExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::time::timeout;

use crate::error::{AppError, AppResult};
use crate::storage::Storage;

const MAX_HEADER_BYTES: usize = 8 * 1024;
const READ_BUFFER: usize = 64 * 1024;
const READY_TIMEOUT: Duration = Duration::from_secs(10);
const READ_STALL_TIMEOUT: Duration = Duration::from_secs(15);
// A paused task cannot fill missing pieces until the user explicitly resumes it.
const PAUSED_READ_TIMEOUT: Duration = Duration::from_secs(2);
const RESPONSE_HEADERS: &str = "Cache-Control: no-store, no-cache, must-revalidate\r\nPragma: no-cache\r\nAccept-Ranges: bytes\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Expose-Headers: Content-Range, Content-Length\r\nConnection: close\r\n";

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

    pub(super) fn file_url(&self, info_hash: &str, path: &str) -> String {
        let query = url::form_urlencoded::Serializer::new(String::new())
            .append_pair("path", path)
            .finish();
        format!(
            "http://127.0.0.1:{}/{}/file/{}?{}",
            self.port, self.token, info_hash, query
        )
    }
}

async fn accept_loop(
    listener: TcpListener,
    session: Arc<Session>,
    storage: Storage,
    token: String,
) {
    // Dropping this set on shutdown also closes clients and releases stream permits.
    let mut clients = tokio::task::JoinSet::new();
    loop {
        tokio::select! {
            Some(_) = clients.join_next(), if !clients.is_empty() => {},
            accepted = listener.accept(), if clients.len() < 32 => {
                let Ok((stream, _)) = accepted else { break };
                clients.spawn(handle_connection(stream, session.clone(), storage.clone(), token.clone()));
            }
        }
    }
}

struct Request {
    path: String,
    range: Option<(u64, Option<u64>)>,
    invalid_range: bool,
    method: String,
}

trait ReadSeek: AsyncRead + AsyncSeek + Unpin + Send {}
impl<T: AsyncRead + AsyncSeek + Unpin + Send> ReadSeek for T {}

struct Source {
    reader: Box<dyn ReadSeek>,
    total: u64,
    name: String,
    stalled_after: Duration,
}

async fn file_source(
    session: &Arc<Session>,
    storage: &Storage,
    hash: &str,
    relative: String,
) -> AppResult<Source> {
    let hash_id = super::parse_info_hash(hash)?;
    let row = storage
        .get_bt_task(hash)?
        .ok_or_else(|| AppError::from("Download task not found"))?;
    let row_for_path = row.clone();
    let path = crate::commands::run_blocking(move || {
        let path = super::files::resolve_path(Path::new(&row_for_path.work_dir), &relative)?;
        if !path.is_file() {
            return Err(AppError::from("Download file not found"));
        }
        Ok(path)
    })
    .await?;
    if row.status == "completed" {
        let file = tokio::fs::File::open(&path).await?;
        let total = file.metadata().await?.len();
        return Ok(Source {
            reader: Box::new(file),
            total,
            name: path.to_string_lossy().into_owned(),
            stalled_after: READ_STALL_TIMEOUT,
        });
    }
    let handle = super::find_handle(session, &hash_id)?
        .ok_or_else(|| AppError::from("Download task is not initialized"))?;
    let index_handle = handle.clone();
    let index = crate::commands::run_blocking(move || {
        super::files::selected_index(&index_handle, &row, &path)
    })
    .await?;
    torrent_source(handle, index).await
}

async fn torrent_source(handle: super::TorrentHandle, index: usize) -> AppResult<Source> {
    let unavailable = || AppError::from("Torrent metadata is not ready");
    timeout(READY_TIMEOUT, handle.wait_until_initialized())
        .await
        .map_err(|_| unavailable())?
        .map_err(|_| unavailable())?;
    let (total, name) = handle
        .with_metadata(|metadata| {
            metadata.file_infos.get(index).map(|file| {
                (
                    file.len,
                    file.relative_filename.to_string_lossy().into_owned(),
                )
            })
        })
        .ok()
        .flatten()
        .ok_or_else(unavailable)?;
    let stalled_after = if handle.is_paused() {
        PAUSED_READ_TIMEOUT
    } else {
        READ_STALL_TIMEOUT
    };
    let reader = timeout(READY_TIMEOUT, handle.stream(index))
        .await
        .map_err(|_| unavailable())?
        .map_err(|_| unavailable())?;
    Ok(Source {
        reader: Box::new(reader),
        total,
        name,
        stalled_after,
    })
}

async fn handle_connection(
    mut stream: TcpStream,
    session: Arc<Session>,
    storage: Storage,
    token: String,
) {
    let Ok(Ok(Some(request))) = timeout(READY_TIMEOUT, read_request(&mut stream)).await else {
        return;
    };
    let prefix = format!("/{token}/");
    let Some(route) = request.path.strip_prefix(&prefix) else {
        let _ = write_simple(&mut stream, 404, "Not Found").await;
        return;
    };
    if request.method == "OPTIONS" {
        let _ = stream.write_all(format!("HTTP/1.1 204 No Content\r\n{RESPONSE_HEADERS}Access-Control-Allow-Methods: GET, HEAD, OPTIONS\r\nAccess-Control-Allow-Headers: Range\r\nContent-Length: 0\r\n\r\n").as_bytes()).await;
        return;
    }
    if !matches!(request.method.as_str(), "GET" | "HEAD") {
        let _ = write_simple(&mut stream, 405, "Method Not Allowed").await;
        return;
    }
    let source = if let Some(route) = route.strip_prefix("file/") {
        let Some((hash, query)) = route.split_once('?') else {
            return;
        };
        let Some((_, path)) =
            url::form_urlencoded::parse(query.as_bytes()).find(|(key, _)| key == "path")
        else {
            return;
        };
        file_source(&session, &storage, hash, path.into_owned()).await
    } else if let Some((hash, index)) = route.strip_prefix("stream/").and_then(split_route) {
        let selected = storage
            .get_bt_task(&hash)
            .ok()
            .flatten()
            .is_some_and(|task| task.file_indices.is_empty() || task.file_indices.contains(&index));
        let handle = super::parse_info_hash(&hash)
            .ok()
            .and_then(|hash| super::find_handle(&session, &hash).ok().flatten());
        match handle.filter(|_| selected) {
            Some(handle) => torrent_source(handle, index).await,
            None => Err(AppError::from("Download file not found")),
        }
    } else {
        Err(AppError::from("Download file not found"))
    };
    let Ok(source) = source else {
        let _ = write_simple(&mut stream, 404, "Not Found").await;
        return;
    };
    respond_with_range(&mut stream, source, request).await;
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
    let mut first = lines.next()?.split_whitespace();
    let method = first.next()?.to_string();
    let path = first.next()?.to_string();
    let header = lines
        .filter_map(|line| line.split_once(':'))
        .find(|(name, _)| name.eq_ignore_ascii_case("range"));
    let range = header.and_then(|(_, value)| parse_range(value));
    Some(Request {
        path,
        range,
        invalid_range: header.is_some() && range.is_none(),
        method,
    })
}

fn parse_range(header: &str) -> Option<(u64, Option<u64>)> {
    let value = header.trim().strip_prefix("bytes=")?;
    if value.contains(',') {
        return None;
    }
    let (start, end) = value.split_once('-')?;
    if start.is_empty() {
        return Some((u64::MAX, Some(end.parse().ok()?)));
    }
    Some((
        start.parse().ok()?,
        if end.is_empty() {
            None
        } else {
            Some(end.parse().ok()?)
        },
    ))
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
            format!("HTTP/1.1 {status} {reason}\r\n{RESPONSE_HEADERS}Content-Length: 0\r\n\r\n")
                .as_bytes(),
        )
        .await?;
    stream.shutdown().await
}

async fn respond_with_range(stream: &mut TcpStream, mut source: Source, request: Request) {
    let total = source.total;
    if total == 0 && request.range.is_none() && !request.invalid_range {
        let _ = write_simple(stream, 200, "OK").await;
        return;
    }
    let resolved = (!request.invalid_range)
        .then(|| resolve_range(total, request.range))
        .flatten();
    let Some((start, end, status)) = resolved else {
        let _ = stream.write_all(format!("HTTP/1.1 416 Range Not Satisfiable\r\n{RESPONSE_HEADERS}Content-Range: bytes */{total}\r\nContent-Length: 0\r\n\r\n").as_bytes()).await;
        return;
    };
    let length = end - start + 1;
    let content_type = mime_guess::from_path(&source.name)
        .first_or_octet_stream()
        .to_string();
    let content_range = if status == 206 {
        format!("Content-Range: bytes {start}-{end}/{total}\r\n")
    } else {
        String::new()
    };
    let reason = if status == 206 {
        "Partial Content"
    } else {
        "OK"
    };
    let header = format!("HTTP/1.1 {status} {reason}\r\n{RESPONSE_HEADERS}Content-Type: {content_type}\r\nContent-Length: {length}\r\n{content_range}\r\n");
    if request.method == "HEAD" {
        let _ = stream.write_all(header.as_bytes()).await;
        return;
    }
    if source
        .reader
        .seek(std::io::SeekFrom::Start(start))
        .await
        .is_err()
    {
        return;
    }
    let mut remaining = length;
    let mut buffer = vec![0u8; READ_BUFFER];
    let mut sent_header = false;
    while remaining > 0 {
        let want = remaining.min(buffer.len() as u64) as usize;
        let mut disconnected = [0u8; 1];
        // A closed preview must not retain an engine read permit while waiting for a piece.
        let read = tokio::select! {
            read = timeout(source.stalled_after, source.reader.read(&mut buffer[..want])) => read,
            _ = stream.peek(&mut disconnected) => return,
        };
        let count = match read {
            Ok(Ok(count)) if count > 0 => count,
            _ => {
                if !sent_header {
                    let _ = write_simple(stream, 503, "Piece Not Available").await;
                }
                return;
            }
        };
        if !sent_header {
            if stream.write_all(header.as_bytes()).await.is_err() {
                return;
            }
            sent_header = true;
        }
        if !matches!(
            timeout(READ_STALL_TIMEOUT, stream.write_all(&buffer[..count])).await,
            Ok(Ok(()))
        ) {
            return;
        }
        remaining -= count as u64;
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
