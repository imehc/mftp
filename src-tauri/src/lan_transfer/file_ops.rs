use crate::error::{AppError, AppResult};
use crate::models::{LanSharedDir, LanTransferTask};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::sync::Arc;

pub(super) fn shares_json(shares: &[LanSharedDir]) -> String {
    let items = shares
        .iter()
        .map(|share| {
            format!(
                r#"{{"id":"{}","name":"{}"}}"#,
                super::escape_json(&share.id),
                super::escape_json(&share.name)
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    format!("[{items}]")
}

pub(super) fn browse_json(first_line: &str, shares: &[LanSharedDir]) -> AppResult<String> {
    let path = resolve_request_path(first_line, shares)?;
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(path)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        let meta = entry.metadata()?;
        entries.push(format!(
            r#"{{"name":"{}","isDir":{},"size":{}}}"#,
            super::escape_json(&name),
            meta.is_dir(),
            meta.len()
        ));
    }
    Ok(format!(r#"{{"entries":[{}]}}"#, entries.join(",")))
}

pub(super) fn resolve_request_path(
    first_line: &str,
    shares: &[LanSharedDir],
) -> AppResult<PathBuf> {
    let query = first_line
        .split_whitespace()
        .nth(1)
        .and_then(|target| target.split_once('?').map(|(_, query)| query))
        .ok_or_else(|| AppError("missing query".into()))?;
    let share_id = query_param(query, "share").ok_or_else(|| AppError("missing share".into()))?;
    let rel = query_param(query, "path").unwrap_or_default();
    resolve_shared_path(&share_id, &rel, shares)
}

fn resolve_shared_path(share_id: &str, rel: &str, shares: &[LanSharedDir]) -> AppResult<PathBuf> {
    if rel.contains("..") || rel.starts_with('/') || rel.starts_with('\\') {
        return Err(AppError("invalid path".into()));
    }
    let share = shares
        .iter()
        .find(|item| item.id == share_id)
        .ok_or_else(|| AppError("unknown share".into()))?;
    let base = std::fs::canonicalize(&share.path)?;
    let target = std::fs::canonicalize(base.join(rel)).unwrap_or_else(|_| base.clone());
    if !target.starts_with(&base) {
        return Err(AppError("path out of share".into()));
    }
    Ok(target)
}

pub(super) fn query_param(query: &str, key: &str) -> Option<String> {
    query.split('&').find_map(|part| {
        let (k, v) = part.split_once('=')?;
        (k == key).then(|| percent_decode(v))
    })
}

pub(super) fn request_query_param(first_line: &str, key: &str) -> Option<String> {
    let query = first_line
        .split_whitespace()
        .nth(1)
        .and_then(|target| target.split_once('?').map(|(_, query)| query))?;
    query_param(query, key)
}

pub(super) fn save_upload(
    request_head: &str,
    initial: &[u8],
    stream: &mut TcpStream,
    download_dir: &str,
    tasks: &Arc<Mutex<HashMap<String, LanTransferTask>>>,
    peer_ip: &str,
) -> AppResult<String> {
    let first_line = request_head.lines().next().unwrap_or_default();
    let query = first_line
        .split_whitespace()
        .nth(1)
        .and_then(|target| target.split_once('?').map(|(_, query)| query))
        .ok_or_else(|| AppError("missing upload name".into()))?;
    let name = query_param(query, "name").ok_or_else(|| AppError("missing upload name".into()))?;
    let conflict = query_param(query, "conflict").unwrap_or_else(|| "rename".to_string());
    let relative_path = sanitize_upload_relative_path(&name)?;
    let content_length = request_head
        .lines()
        .find_map(|line| {
            let (key, value) = line.split_once(':')?;
            key.eq_ignore_ascii_case("content-length")
                .then(|| value.trim().parse::<usize>().ok())
                .flatten()
        })
        .ok_or_else(|| AppError("missing content-length".into()))?;
    let content_range = upload_content_range(request_head);
    let upload_total = content_range
        .map(|range| range.total)
        .unwrap_or(content_length as u64);
    let upload_start = content_range.map(|range| range.start).unwrap_or(0);
    let header_end = initial
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|pos| pos + 4)
        .ok_or_else(|| AppError("bad request".into()))?;
    std::fs::create_dir_all(download_dir)?;
    let available = fs2::available_space(download_dir)?;
    if available < content_length as u64 {
        return Err(AppError(format!(
            "insufficient disk space: need {}, available {}",
            human_bytes(content_length as u64),
            human_bytes(available)
        )));
    }
    let path = if upload_start > 0 || conflict == "resume" {
        Path::new(download_dir).join(&relative_path)
    } else {
        upload_path_for_conflict(Path::new(download_dir), &relative_path, &conflict)?
    };
    let saved_name = path
        .strip_prefix(download_dir)
        .unwrap_or(&path)
        .to_string_lossy()
        .to_string();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let task_id = uuid::Uuid::new_v4().to_string();
    super::tasks::upsert_task(
        tasks,
        LanTransferTask {
            id: task_id.clone(),
            direction: "upload".to_string(),
            file_name: saved_name.clone(),
            ip: peer_ip.to_string(),
            status: "running".to_string(),
            transferred: 0,
            total: upload_total,
            started_at: super::now_ms(),
            updated_at: super::now_ms(),
        },
    );
    let mut file = open_upload_file(&path, upload_start)?;
    let mut written = upload_start as usize;
    let body = &initial[header_end..];
    file.write_all(body)?;
    written += body.len();
    super::tasks::update_task_progress(tasks, &task_id, written as u64, "running");
    let mut buf = [0u8; 64 * 1024];
    while written < upload_total as usize {
        if super::tasks::task_is_canceled(tasks, &task_id) {
            return Err(AppError("transfer canceled".into()));
        }
        let n = stream.read(&mut buf)?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n])?;
        written += n;
        super::tasks::update_task_progress(tasks, &task_id, written as u64, "running");
    }
    if written < upload_total as usize {
        return Err(AppError("upload incomplete".into()));
    }
    super::tasks::update_task_progress(tasks, &task_id, written as u64, "success");
    super::http_io::write_response(stream, "200 OK", "application/json", br#"{"ok":true}"#)?;
    Ok(saved_name)
}

fn sanitize_upload_relative_path(value: &str) -> AppResult<PathBuf> {
    let normalized = value.replace('\\', "/");
    let path = Path::new(&normalized);
    if normalized.trim().is_empty() || path.is_absolute() {
        return Err(AppError("invalid upload name".into()));
    }
    let mut safe = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::Normal(value) => safe.push(value),
            _ => return Err(AppError("invalid upload name".into())),
        }
    }
    if safe.as_os_str().is_empty() {
        return Err(AppError("invalid upload name".into()));
    }
    Ok(safe)
}

pub(super) fn upload_target_exists(first_line: &str, download_dir: &str) -> AppResult<bool> {
    let query = first_line
        .split_whitespace()
        .nth(1)
        .and_then(|target| target.split_once('?').map(|(_, query)| query))
        .ok_or_else(|| AppError("missing upload name".into()))?;
    let name = query_param(query, "name").ok_or_else(|| AppError("missing upload name".into()))?;
    let relative_path = sanitize_upload_relative_path(&name)?;
    Ok(Path::new(download_dir).join(relative_path).exists())
}

pub(super) fn upload_offset_json(first_line: &str, download_dir: &str) -> AppResult<String> {
    let query = first_line
        .split_whitespace()
        .nth(1)
        .and_then(|target| target.split_once('?').map(|(_, query)| query))
        .ok_or_else(|| AppError("missing upload name".into()))?;
    let name = query_param(query, "name").ok_or_else(|| AppError("missing upload name".into()))?;
    let expected_size = query_param(query, "size").and_then(|value| value.parse::<u64>().ok());
    let relative_path = sanitize_upload_relative_path(&name)?;
    let path = Path::new(download_dir).join(relative_path);
    let offset = path.metadata().map(|meta| meta.len()).unwrap_or(0);
    let complete = expected_size
        .map(|size| size > 0 && offset >= size)
        .unwrap_or_else(|| offset > 0);
    Ok(format!(r#"{{"offset":{offset},"complete":{complete}}}"#))
}

#[derive(Clone, Copy)]
struct UploadContentRange {
    start: u64,
    total: u64,
}

fn upload_content_range(request_head: &str) -> Option<UploadContentRange> {
    let header = request_head.lines().find_map(|line| {
        let (key, value) = line.split_once(':')?;
        key.eq_ignore_ascii_case("content-range")
            .then(|| value.trim().to_string())
    })?;
    let range = header.strip_prefix("bytes ")?;
    let (span, total) = range.split_once('/')?;
    let (start, end) = span.split_once('-')?;
    let start = start.parse::<u64>().ok()?;
    let end = end.parse::<u64>().ok()?;
    let total = total.parse::<u64>().ok()?;
    (start <= end && end < total).then_some(UploadContentRange { start, total })
}

fn open_upload_file(path: &Path, start: u64) -> AppResult<std::fs::File> {
    if start == 0 {
        return Ok(std::fs::File::create(path)?);
    }
    let mut file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)?;
    let len = file.metadata()?.len();
    if len != start {
        return Err(AppError(format!(
            "resume offset mismatch: local {len}, request {start}"
        )));
    }
    file.seek(SeekFrom::Start(start))?;
    Ok(file)
}

fn upload_path_for_conflict(
    dir: &Path,
    relative_path: &Path,
    conflict: &str,
) -> AppResult<PathBuf> {
    match conflict {
        "overwrite" => Ok(dir.join(relative_path)),
        "rename" | "" => Ok(unique_upload_path(dir, relative_path)),
        _ => Err(AppError("invalid conflict mode".into())),
    }
}

fn unique_upload_path(dir: &Path, relative_path: &Path) -> PathBuf {
    let candidate = dir.join(relative_path);
    if !candidate.exists() {
        return candidate;
    }
    let file_name = relative_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("file");
    let parent = relative_path.parent().unwrap_or_else(|| Path::new(""));
    let stem = Path::new(file_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("file");
    let ext = Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str());
    for index in 1..1000 {
        let renamed = match ext {
            Some(ext) => format!("{stem} ({index}).{ext}"),
            None => format!("{stem} ({index})"),
        };
        let next = dir.join(parent).join(renamed);
        if !next.exists() {
            return next;
        }
    }
    dir.join(parent)
        .join(format!("{stem}-{}", uuid::Uuid::new_v4()))
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(hex) = u8::from_str_radix(&value[i + 1..i + 3], 16) {
                out.push(hex);
                i += 3;
                continue;
            }
        }
        out.push(if bytes[i] == b'+' { b' ' } else { bytes[i] });
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

fn human_bytes(value: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    const GB: f64 = MB * 1024.0;
    let value_f = value as f64;
    if value_f >= GB {
        format!("{:.1} GB", value_f / GB)
    } else if value_f >= MB {
        format!("{:.1} MB", value_f / MB)
    } else if value_f >= KB {
        format!("{:.1} KB", value_f / KB)
    } else {
        format!("{value} B")
    }
}
