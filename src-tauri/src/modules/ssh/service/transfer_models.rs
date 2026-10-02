use super::super::ports::emit_progress;
use super::super::ports::EventSink;
use super::path_utils::{join_remote, remote_basename};
use super::types::TransferGuard;
use crate::error::{AppError, AppResult, CustomErrorCode};
use crate::modules::ssh::{SftpEntry, SftpFileInfo};
use ssh2::FileStat;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use walkdir::WalkDir;

pub(super) fn sftp_entries(read_dir: Vec<(PathBuf, FileStat)>) -> Vec<SftpEntry> {
    let mut entries = Vec::new();
    for (p, stat) in read_dir {
        let name = p
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        if name.is_empty() {
            continue;
        }
        entries.push(SftpEntry {
            name,
            path: p.to_string_lossy().to_string(),
            is_dir: stat.is_dir(),
            is_symlink: stat.file_type().is_symlink(),
            size: stat.size.unwrap_or(0),
            mtime: stat.mtime.unwrap_or(0),
            mode: stat.perm.unwrap_or(0),
        });
    }
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    entries
}

pub(super) fn sftp_file_info(path: &str, stat: FileStat, created_at: Option<u64>) -> SftpFileInfo {
    let name = {
        let basename = remote_basename(path);
        if basename.is_empty() {
            path.to_string()
        } else {
            basename
        }
    };

    SftpFileInfo {
        name,
        path: path.to_string(),
        is_dir: stat.is_dir(),
        is_symlink: stat.file_type().is_symlink(),
        size: stat.size.unwrap_or(0),
        atime: stat.atime.unwrap_or(0),
        mtime: stat.mtime.unwrap_or(0),
        created_at,
        mode: stat.perm.unwrap_or(0),
        uid: stat.uid,
        gid: stat.gid,
    }
}

pub(super) fn parse_remote_birth_time(stdout: &str) -> Option<u64> {
    stdout.lines().find_map(|line| {
        let value = line.trim().parse::<i64>().ok()?;
        (value > 0).then_some(value as u64)
    })
}

pub(super) enum UploadEntryKind {
    Directory,
    File { size: u64 },
    Symlink { target: String },
}

pub(super) struct UploadEntry {
    pub(super) local: PathBuf,
    pub(super) remote: String,
    pub(super) kind: UploadEntryKind,
}

pub(super) struct UploadPlan {
    pub(super) entries: Vec<UploadEntry>,
    pub(super) total_file_bytes: u64,
}

pub(super) enum DownloadEntryKind {
    Directory,
    File { size: u64 },
    Symlink { target: String },
}

pub(super) struct DownloadEntry {
    pub(super) remote: String,
    pub(super) local: PathBuf,
    pub(super) kind: DownloadEntryKind,
}

pub(super) struct DownloadPlan {
    pub(super) entries: Vec<DownloadEntry>,
    pub(super) total_file_bytes: u64,
}

pub(super) struct ProgressReader<'a, R: Read> {
    pub(super) inner: R,
    pub(super) events: Option<&'a EventSink>,
    pub(super) transfer_id: Option<&'a str>,
    pub(super) phase: &'a str,
    pub(super) transferred: &'a mut u64,
    pub(super) total: Option<u64>,
    pub(super) last_emit: &'a mut Instant,
    pub(super) transfer: Option<&'a TransferGuard>,
}

impl<R: Read> Read for ProgressReader<'_, R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        if let Some(transfer) = self.transfer {
            transfer
                .check()
                .map_err(|error| std::io::Error::other(error))?;
        }
        let n = self.inner.read(buf)?;
        if n > 0 {
            *self.transferred += n as u64;
            if self.last_emit.elapsed() >= Duration::from_millis(120) {
                emit_progress(
                    self.events,
                    self.transfer_id,
                    self.phase,
                    *self.transferred,
                    self.total,
                );
                *self.last_emit = Instant::now();
            }
        }
        Ok(n)
    }
}

pub(super) struct TransferReader<'a, R: Read> {
    pub(super) inner: R,
    pub(super) transfer: Option<&'a TransferGuard>,
}

impl<R: Read> Read for TransferReader<'_, R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        if let Some(transfer) = self.transfer {
            transfer
                .check()
                .map_err(|error| std::io::Error::other(error))?;
        }
        self.inner.read(buf)
    }
}

pub(super) fn build_upload_plan(local_dir: &str, remote_root: &str) -> AppResult<UploadPlan> {
    let root = Path::new(local_dir);
    if !root.is_dir() {
        return Err(AppError::custom(CustomErrorCode::SftpNotDirectory));
    }

    let mut entries = Vec::new();
    let mut total_file_bytes = 0u64;
    for entry in WalkDir::new(root).follow_links(false).into_iter() {
        let entry = entry.map_err(|e| AppError::from(e).context("Scanning directory"))?;
        let local = entry.path().to_path_buf();
        let relative = local.strip_prefix(root).unwrap_or(Path::new(""));
        let remote = remote_path_for_relative(remote_root, relative);
        let file_type = entry.file_type();

        let kind = if file_type.is_dir() {
            UploadEntryKind::Directory
        } else if file_type.is_file() {
            let size = std::fs::symlink_metadata(&local)?.len();
            total_file_bytes = total_file_bytes.saturating_add(size);
            UploadEntryKind::File { size }
        } else if file_type.is_symlink() {
            let target = std::fs::read_link(&local)?.to_string_lossy().to_string();
            UploadEntryKind::Symlink { target }
        } else {
            return Err(AppError::custom(CustomErrorCode::SftpUnsupportedFile)
                .with_arg("path", local.display()));
        };

        entries.push(UploadEntry {
            local,
            remote,
            kind,
        });
    }

    Ok(UploadPlan {
        entries,
        total_file_bytes,
    })
}

fn remote_path_for_relative(remote_root: &str, relative: &Path) -> String {
    if relative.as_os_str().is_empty() {
        return remote_root.to_string();
    }

    let mut remote = remote_root.to_string();
    for part in relative {
        remote = join_remote(&remote, &part.to_string_lossy());
    }
    remote
}

pub(super) fn should_skip_archive_path(path: &Path) -> bool {
    path.components().any(|component| {
        let name = component.as_os_str().to_string_lossy();
        name == "__MACOSX"
            || name == ".DS_Store"
            || name.starts_with("._")
            || name.eq_ignore_ascii_case("thumbs.db")
            || name.eq_ignore_ascii_case("desktop.ini")
    })
}

pub(super) fn archive_total_file_bytes(local_dir: &str) -> AppResult<u64> {
    let root = Path::new(local_dir);
    let mut total = 0u64;
    let mut iter = WalkDir::new(root).follow_links(false).into_iter();
    while let Some(entry) = iter.next() {
        let entry = entry.map_err(|e| AppError::from(e).context("Scanning directory"))?;
        let relative = entry.path().strip_prefix(root).unwrap_or(Path::new(""));
        if !relative.as_os_str().is_empty() && should_skip_archive_path(relative) {
            if entry.file_type().is_dir() {
                iter.skip_current_dir();
            }
            continue;
        }
        if entry.file_type().is_file() {
            total = total.saturating_add(std::fs::symlink_metadata(entry.path())?.len());
        }
    }
    Ok(total)
}
