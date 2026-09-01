//! Loopback streaming server: serves torrent files (possibly incomplete)
//! to the WebView <video> element over HTTP Range requests.
//!
//! Security boundary:
//! - Binds 127.0.0.1 on a random port only; the path carries a per-process
//!   random token so other local processes cannot guess URLs (path traversal
//!   is excluded by the fixed route shape; ".." is rejected).
//! - Playback URLs live for the playback session only; closing the player
//!   tears the stream down.
//!
//! Implementation note: FileStream is a tokio AsyncRead whose read side
//! blocks until the required piece is available, so Range semantics give us
//! stream-while-downloading plus seeking for free.

use std::sync::Arc;
use std::time::Duration;

use librqbit::Session;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::time::timeout;

/// Header size cap; request line plus a few headers is plenty.
const MAX_HEADER_BYTES: usize = 8 * 1024;
const READ_BUFFER: usize = 64 * 1024;

/// `add_torrent` returns while the torrent is still initializing (file check
/// and allocation run in a spawned task), and librqbit refuses to open a
/// FileStream in that state. Waiting here beats failing the request: the
/// player treats the first broken response as fatal and never retries.
const READY_TIMEOUT: Duration = Duration::from_secs(30);

/// Give up on a response that has not produced a byte for this long. An open
/// FileStream holds one of the session's blocking permits (8 by default,
/// shared with piece writeback), so a read parked on a piece nobody is
/// serving must not keep the connection alive forever.
const READ_STALL_TIMEOUT: Duration = Duration::from_secs(90);

pub struct StreamServer {
    port: u16,
    token: String,
    /// pub(super): BtManager::shutdown aborts the accept loop.
    pub(super) accept_task: tokio::task::JoinHandle<()>,
}

impl StreamServer {
    /// Bind a random port and start accepting connections. Returns None on
    /// failure — the frontend surfaces a clear error while downloads keep
    /// working unaffected.
    pub async fn spawn(
        session: Arc<Session>,
        active_streams: super::ActiveStreams,
    ) -> Option<Self> {
        let token = uuid::Uuid::new_v4().to_string();
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.ok()?;
        let port = listener.local_addr().ok()?.port();
        let accept = tokio::spawn(accept_loop(
            listener,
            session,
            token.clone(),
            active_streams,
        ));
        Some(Self {
            port,
            token,
            accept_task: accept,
        })
    }

    pub fn url_for(&self, info_hash_hex: &str, file_index: usize) -> String {
        format!(
            "http://127.0.0.1:{}/{}/stream/{}/{}",
            self.port, self.token, info_hash_hex, file_index
        )
    }
}

async fn accept_loop(
    listener: TcpListener,
    session: Arc<Session>,
    token: String,
    active_streams: super::ActiveStreams,
) {
    loop {
        match listener.accept().await {
            Ok((stream, _)) => {
                let session = session.clone();
                let token = token.clone();
                let active = active_streams.clone();
                tokio::spawn(handle_connection(stream, session, token, active));
            }
            Err(_) => continue,
        }
    }
}

struct Request {
    path: String,
    range: Option<(u64, Option<u64>)>,
}

async fn handle_connection(
    mut stream: TcpStream,
    session: Arc<Session>,
    token: String,
    active: super::ActiveStreams,
) {
    let Ok(Some(request)) = read_request(&mut stream).await else {
        return;
    };
    let expected = format!("/{token}/stream/");
    let rest = match request.path.strip_prefix(&expected) {
        Some(rest) if !rest.contains("..") => rest,
        _ => {
            let _ = write_simple(&mut stream, 404, "Not Found").await;
            return;
        }
    };
    let Some((info_hash_hex, file_index)) = split_route(rest) else {
        let _ = write_simple(&mut stream, 404, "Not Found").await;
        return;
    };

    let hash = match super::parse_info_hash(&info_hash_hex) {
        Ok(hash) => hash,
        Err(_) => {
            let _ = write_simple(&mut stream, 404, "Not Found").await;
            return;
        }
    };
    let Some(handle) = super::find_handle(&session, &hash).unwrap_or(None) else {
        let _ = write_simple(&mut stream, 404, "Not Found").await;
        return;
    };

    // Restored torrents come back parked (BtManager::pause_restored_torrents)
    // and a fresh add is still initializing; either way, reach a state that
    // can actually stream before committing to a response.
    if !wait_until_streamable(&session, &handle).await {
        let _ = write_simple(&mut stream, 503, "Torrent Not Ready").await;
        return;
    }

    // The active count exempts a task from LRU eviction; decrement on
    // close, including abrupt disconnects.
    if let Ok(mut map) = active.lock() {
        *map.entry(info_hash_hex.clone()).or_insert(0) += 1;
    }
    respond_with_file_range(&mut stream, handle, file_index, request.range).await;
    if let Ok(mut map) = active.lock() {
        let remove = match map.get_mut(&info_hash_hex) {
            Some(count) => {
                *count -= 1;
                *count == 0
            }
            None => false,
        };
        if remove {
            map.remove(&info_hash_hex);
        }
    }
}

/// Block until the torrent can serve bytes: initialization finished and the
/// torrent is not parked. Returns false when it errored or took too long, so
/// the caller can answer with a status instead of an empty body.
async fn wait_until_streamable(session: &Arc<Session>, handle: &super::TorrentHandle) -> bool {
    if !matches!(
        timeout(READY_TIMEOUT, handle.wait_until_initialized()).await,
        Ok(Ok(()))
    ) {
        return false;
    }
    if handle.is_paused() {
        let _ = session.unpause(handle).await;
    }
    true
}

fn split_route(rest: &str) -> Option<(String, usize)> {
    let (hex_part, index_part) = rest.split_once('/')?;
    let file_index = index_part.parse::<usize>().ok()?;
    (!hex_part.is_empty()).then(|| (hex_part.to_string(), file_index))
}

async fn read_request(stream: &mut TcpStream) -> std::io::Result<Option<Request>> {
    let mut buf = Vec::with_capacity(1024);
    let mut chunk = [0u8; 512];
    loop {
        let n = stream.read(&mut chunk).await?;
        if n == 0 {
            return Ok(None);
        }
        buf.extend_from_slice(&chunk[..n]);
        if buf.len() > MAX_HEADER_BYTES {
            return Ok(None);
        }
        if let Some(header_end) = find_header_end(&buf) {
            return Ok(parse_request(&buf[..header_end]));
        }
    }
}

fn find_header_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n").map(|p| p + 4)
}

fn parse_request(raw: &[u8]) -> Option<Request> {
    let text = std::str::from_utf8(raw).ok()?;
    let mut lines = text.lines();
    let request_line = lines.next()?;
    let path = request_line.split_whitespace().nth(1)?.to_string();
    let mut range = None;
    for line in lines {
        if let Some(value) = line.strip_prefix("Range:") {
            range = parse_range(value.trim());
        }
    }
    Some(Request { path, range })
}

/// Supports bytes=a-b / bytes=a- / bytes=-suffix; multi-range takes the first.
fn parse_range(header: &str) -> Option<(u64, Option<u64>)> {
    let spec = header.strip_prefix("bytes=")?;
    let first = spec.split(',').next()?.trim();
    let (start_part, end_part) = first.split_once('-')?;
    if start_part.trim().is_empty() {
        // bytes=-N: last N bytes; sentinel start distinguishes it from a
        // regular offset.
        let suffix = end_part.trim().parse::<u64>().ok()?;
        return Some((u64::MAX, Some(suffix)));
    }
    let start = start_part.trim().parse::<u64>().ok()?;
    let end = end_part.trim().parse::<u64>().ok();
    Some((start, end))
}

async fn write_simple(stream: &mut TcpStream, status: u16, reason: &str) -> std::io::Result<()> {
    stream
        .write_all(
            format!("HTTP/1.1 {status} {reason}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                .as_bytes(),
        )
        .await?;
    stream.shutdown().await
}

async fn respond_with_file_range(
    stream: &mut TcpStream,
    handle: super::TorrentHandle,
    file_index: usize,
    range: Option<(u64, Option<u64>)>,
) {
    // Name/length: respond 404 when metadata is not ready yet; the player
    // surfaces its error branch.
    let meta = handle.metadata.load_full();
    let Some(meta) = meta else {
        let _ = write_simple(stream, 404, "Metadata Not Ready").await;
        return;
    };
    let Some(file_info) = meta.file_infos.get(file_index) else {
        let _ = write_simple(stream, 404, "Not Found").await;
        return;
    };
    let total = file_info.len;
    let content_type = mime_guess::from_path(&file_info.relative_filename)
        .first_or_octet_stream()
        .to_string();

    // Resolve the final byte range [start, end] (both inclusive).
    let (start, end, status) = match range {
        None => (0u64, total.saturating_sub(1), 200),
        Some((u64::MAX, Some(suffix))) => {
            // bytes=-N
            if suffix == 0 || total == 0 {
                let _ = write_simple(stream, 416, "Range Not Satisfiable").await;
                return;
            }
            let len = suffix.min(total);
            (total - len, total - 1, 206)
        }
        Some((start, end_opt)) => {
            if total == 0 || start >= total {
                let _ = write_simple(stream, 416, "Range Not Satisfiable").await;
                return;
            }
            let end = end_opt.unwrap_or(total - 1).min(total - 1);
            (start, end.max(start), 206)
        }
    };
    let length = end - start + 1;

    let head = if status == 206 {
        format!(
            "HTTP/1.1 206 Partial Content\r\nContent-Type: {content_type}\r\nContent-Length: {length}\r\nContent-Range: bytes {start}-{end}/{total}\r\nAccept-Ranges: bytes\r\nConnection: close\r\n\r\n"
        )
    } else {
        format!(
            "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {length}\r\nAccept-Ranges: bytes\r\nConnection: close\r\n\r\n"
        )
    };
    if stream.write_all(head.as_bytes()).await.is_err() {
        return;
    }

    // HEAD-style requests carry no body; treated as GET throughout (no
    // browser preflight needs anything else).
    let mut file_stream = match handle.clone().stream(file_index).await {
        Ok(fs) => fs,
        Err(_) => return,
    };
    if file_stream
        .seek(std::io::SeekFrom::Start(start))
        .await
        .is_err()
    {
        return;
    }
    let mut remaining = length;
    let mut buffer = vec![0u8; READ_BUFFER.min(length as usize).max(1)];
    while remaining > 0 {
        let want = buffer.len().min(remaining as usize);
        // FileStream reads block until the piece under the read head lands, so
        // a swarm that cannot serve it would otherwise hold this connection
        // (and a blocking permit) open indefinitely.
        match timeout(READ_STALL_TIMEOUT, file_stream.read(&mut buffer[..want])).await {
            Ok(Ok(0)) | Err(_) => break,
            Ok(Ok(n)) => {
                if stream.write_all(&buffer[..n]).await.is_err() {
                    return;
                }
                remaining -= n as u64;
            }
            Ok(Err(_)) => return,
        }
    }
    let _ = stream.flush().await;
    let _ = stream.shutdown().await;
}
