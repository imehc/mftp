//! Local Range server reading original files or verified torrent pieces, never a cache.

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use librqbit::Session;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::time::timeout;

use super::preview_reader::Reader;
use super::workers::{Worker, Workers};
use crate::core::http_range::{parse_request_range, RangeRequest};
use crate::error::{AppError, AppResult, CustomErrorCode};
use crate::modules::bt::repository::BtRepository;

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
    workers: Workers,
    accept_task: Option<tokio::task::JoinHandle<()>>,
}

impl StreamServer {
    pub(super) async fn spawn(session: Arc<Session>, repository: BtRepository) -> Option<Self> {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.ok()?;
        let port = listener.local_addr().ok()?.port();
        let token = uuid::Uuid::new_v4().to_string();
        let (workers, worker) = Workers::new();
        let accept_task = tokio::spawn(worker.clone().track(accept_loop(
            listener,
            session,
            repository,
            token.clone(),
            worker,
        )));
        Some(Self {
            port,
            token,
            workers,
            accept_task: Some(accept_task),
        })
    }

    pub(super) fn cancel(&self) {
        self.workers.cancel();
    }

    pub(super) async fn stop(&mut self) {
        self.cancel();
        self.workers.wait().await;
        if let Some(task) = self.accept_task.as_mut() {
            if let Err(error) = task.await {
                eprintln!(
                    "BT preview accept loop failed (panic: {})",
                    error.is_panic()
                );
            }
            self.accept_task.take();
        }
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
    repository: BtRepository,
    token: String,
    worker: Worker,
) {
    // Cancellation wakes idle accepts and clients stalled on headers, pieces or
    // socket writes. Their blocking children keep completion independently.
    let mut clients = tokio::task::JoinSet::new();
    loop {
        tokio::select! {
            biased;
            _ = worker.cancelled() => break,
            Some(_) = clients.join_next(), if !clients.is_empty() => {},
            accepted = listener.accept(), if clients.len() < 32 => {
                let Ok((stream, _)) = accepted else { break };
                let session = session.clone();
                let repository = repository.clone();
                let token = token.clone();
                let worker = worker.clone();
                clients.spawn(worker.clone().track(async move {
                    tokio::select! {
                        biased;
                        _ = worker.cancelled() => {},
                        _ = handle_connection(stream, session, repository, token, &worker) => {},
                    }
                }));
            }
        }
    }
    drop(listener);
    clients.abort_all();
    while clients.join_next().await.is_some() {}
}

struct Request {
    path: String,
    range: RangeRequest,
    method: String,
}

struct Source {
    reader: Reader,
    total: u64,
    name: String,
    stalled_after: Duration,
}

async fn file_source(
    session: &Arc<Session>,
    repository: &BtRepository,
    hash: &str,
    relative: String,
    worker: &Worker,
) -> AppResult<Source> {
    let hash_id = super::parse_info_hash(hash)?;
    let row = repository
        .get_bt_task(hash)?
        .ok_or_else(|| AppError::custom(CustomErrorCode::BtTaskNotFound))?;
    let row_for_path = row.clone();
    let path = worker
        .blocking(move || {
            let path = super::files::resolve_path(Path::new(&row_for_path.work_dir), &relative)?;
            if !path.is_file() {
                return Err(AppError::custom(CustomErrorCode::BtFileNotFound));
            }
            Ok(path)
        })
        .await?;
    if row.status == "completed" {
        let name = path.to_string_lossy().into_owned();
        let (reader, total) = Reader::open(path, worker).await?;
        return Ok(Source {
            reader,
            total,
            name,
            stalled_after: READ_STALL_TIMEOUT,
        });
    }
    let handle = super::find_handle(session, &hash_id)?
        .ok_or_else(|| AppError::custom(CustomErrorCode::BtTaskNotInitialized))?;
    let index_handle = handle.clone();
    let index = worker
        .blocking(move || super::files::selected_index(&index_handle, &row, &path))
        .await?;
    torrent_source(handle, index).await
}

async fn torrent_source(handle: super::TorrentHandle, index: usize) -> AppResult<Source> {
    let unavailable = || AppError::custom(CustomErrorCode::BtInfoNotReady);
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
        reader: Reader::Torrent(Box::new(reader)),
        total,
        name,
        stalled_after,
    })
}

async fn handle_connection(
    mut stream: TcpStream,
    session: Arc<Session>,
    repository: BtRepository,
    token: String,
    worker: &Worker,
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
        file_source(&session, &repository, hash, path.into_owned(), worker).await
    } else if let Some((hash, index)) = route.strip_prefix("stream/").and_then(split_route) {
        let selected = repository
            .get_bt_task(&hash)
            .ok()
            .flatten()
            .is_some_and(|task| task.file_indices.is_empty() || task.file_indices.contains(&index));
        let handle = super::parse_info_hash(&hash)
            .ok()
            .and_then(|hash| super::find_handle(&session, &hash).ok().flatten());
        match handle.filter(|_| selected) {
            Some(handle) => torrent_source(handle, index).await,
            None => Err(AppError::custom(CustomErrorCode::BtFileNotFound)),
        }
    } else {
        Err(AppError::custom(CustomErrorCode::BtFileNotFound))
    };
    let Ok(source) = source else {
        let _ = write_simple(&mut stream, 404, "Not Found").await;
        return;
    };
    respond_with_range(&mut stream, source, request, worker).await;
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
    Some(Request {
        path,
        range: parse_request_range(text),
        method,
    })
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

async fn respond_with_range(
    stream: &mut TcpStream,
    mut source: Source,
    request: Request,
    worker: &Worker,
) {
    let total = source.total;
    let Some(range) = request.range.resolve(total) else {
        let _ = stream.write_all(format!("HTTP/1.1 416 Range Not Satisfiable\r\n{RESPONSE_HEADERS}Content-Range: bytes */{total}\r\nContent-Length: 0\r\n\r\n").as_bytes()).await;
        return;
    };
    if range.length == 0 {
        let _ = write_simple(stream, 200, "OK").await;
        return;
    }
    let start = range.start;
    let end = range.end();
    let length = range.length;
    let status = if range.partial { 206 } else { 200 };
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
    if source.reader.seek(start, worker).await.is_err() {
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
            read = timeout(source.stalled_after, source.reader.read(buffer, want, worker)) => read,
            _ = stream.peek(&mut disconnected) => return,
        };
        let (read_buffer, count) = match read {
            Ok(Ok((buffer, count))) if count > 0 => (buffer, count),
            _ => {
                if !sent_header {
                    let _ = write_simple(stream, 503, "Piece Not Available").await;
                }
                return;
            }
        };
        buffer = read_buffer;
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

#[cfg(test)]
#[path = "stream_server_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "stream_shutdown_tests.rs"]
mod shutdown_tests;
