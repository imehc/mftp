//! Task-scoped browsing and direct reads. No preview copies or extraction cache.

use std::path::{Component, Path, PathBuf};

use super::models::{BtFileEntry, BtFileListing, BtFilePreview};
use super::{find_handle, parse_info_hash, BtManager, TorrentHandle};
use crate::commands::run_blocking;
use crate::error::{AppError, AppResult};
use crate::storage::bt::BtTaskRow;

fn path_error(path: &Path, error: &impl std::fmt::Display) -> AppError {
    AppError(format!("Failed to access {}: {error}", path.display()))
}

/// Reject traversal and symlinks before exposing either a directory or a file.
/// The same check is applied again at HTTP read time, not just when issuing a URL.
pub(super) fn resolve_path(root: &Path, relative: &str) -> AppResult<PathBuf> {
    if relative.contains('\\')
        || Path::new(relative)
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(AppError::from("File does not belong to this download task"));
    }
    let root = root
        .canonicalize()
        .map_err(|error| path_error(root, &error))?;
    let mut target = root.clone();
    for part in Path::new(relative).components() {
        target.push(part);
        if std::fs::symlink_metadata(&target)?.file_type().is_symlink() {
            return Err(AppError::from("File does not belong to this download task"));
        }
    }
    let canonical = target
        .canonicalize()
        .map_err(|error| path_error(&target, &error))?;
    if !canonical.starts_with(&root) {
        return Err(AppError::from("File does not belong to this download task"));
    }
    Ok(canonical)
}

fn relative_path(root: &Path, path: &Path) -> AppResult<String> {
    let relative = path
        .strip_prefix(root)
        .map_err(|_| AppError::from("File does not belong to this download task"))?;
    Ok(relative
        .components()
        .map(|part| part.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/"))
}

fn entry(root: &Path, path: &Path) -> AppResult<BtFileEntry> {
    let metadata = std::fs::metadata(path)?;
    if !metadata.is_file() && !metadata.is_dir() {
        return Err(AppError::from("File does not belong to this download task"));
    }
    Ok(BtFileEntry {
        path: relative_path(root, path)?,
        name: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into(),
        is_dir: metadata.is_dir(),
        size: if metadata.is_dir() { 0 } else { metadata.len() },
    })
}

fn list_path(row: &BtTaskRow, relative: &str) -> AppResult<BtFileListing> {
    let root = Path::new(&row.work_dir).canonicalize()?;
    let target = resolve_path(&root, relative)?;
    let current = entry(&root, &target)?;
    let mut entries = Vec::new();
    let archive = (row.package_mode == "archive")
        .then(|| {
            row.output_path
                .as_deref()
                .and_then(|path| Path::new(path).canonicalize().ok())
        })
        .flatten();
    if current.is_dir {
        for item in std::fs::read_dir(target)? {
            let item = item?;
            let kind = item.file_type()?;
            // Generated archives remain export artifacts, not duplicate browser entries.
            if (!kind.is_file() && !kind.is_dir())
                || archive.as_deref() == Some(item.path().as_path())
                || item.file_name().to_string_lossy().ends_with(".mftp-part")
            {
                continue;
            }
            entries.push(entry(&root, &item.path())?);
        }
        entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.cmp(&b.name)));
    }
    Ok(BtFileListing { current, entries })
}

/// Match the actual source path to selected torrent metadata. Sparse file length
/// is not proof of downloaded bytes; incomplete reads must use verified pieces.
pub(super) fn selected_index(
    handle: &TorrentHandle,
    row: &BtTaskRow,
    path: &Path,
) -> AppResult<usize> {
    handle
        .with_metadata(|metadata| {
            metadata
                .file_infos
                .iter()
                .enumerate()
                .find_map(|(index, file)| {
                    if file.attrs.padding
                        || (!row.file_indices.is_empty() && !row.file_indices.contains(&index))
                    {
                        return None;
                    }
                    let candidate = handle.output_folder().join(&file.relative_filename);
                    (candidate.canonicalize().ok().as_deref() == Some(path)).then_some(index)
                })
        })
        .ok()
        .flatten()
        .ok_or_else(|| AppError::from("File does not belong to this download task"))
}

impl BtManager {
    pub async fn browse_files(
        &self,
        info_hash: &str,
        path: Option<String>,
    ) -> AppResult<BtFileListing> {
        let hash = parse_info_hash(info_hash)?;
        let session = self.ensure_engine().await?;
        let row = self
            .storage
            .get_bt_task(info_hash)?
            .ok_or_else(|| AppError::from("Download task not found"))?;
        let handle = find_handle(&session, &hash)?;
        run_blocking(move || {
            let relative = if let Some(path) = path {
                path
            } else if row.package_mode == "direct" {
                let source = row.output_path.as_ref().map(PathBuf::from).or_else(|| {
                    let handle = handle.as_ref()?;
                    let index = *row.file_indices.first()?;
                    handle
                        .with_metadata(|metadata| {
                            metadata
                                .file_infos
                                .get(index)
                                .map(|file| handle.output_folder().join(&file.relative_filename))
                        })
                        .ok()
                        .flatten()
                });
                source
                    .map(|source| relative_path(Path::new(&row.work_dir), &source))
                    .transpose()?
                    .unwrap_or_default()
            } else {
                String::new()
            };
            list_path(&row, &relative)
        })
        .await
    }

    pub async fn preview_file(&self, info_hash: &str, path: String) -> AppResult<BtFilePreview> {
        parse_info_hash(info_hash)?;
        self.ensure_engine().await?;
        let row = self
            .storage
            .get_bt_task(info_hash)?
            .ok_or_else(|| AppError::from("Download task not found"))?;
        let partial = row.status != "completed";
        let relative = path.clone();
        run_blocking(move || {
            let target = resolve_path(Path::new(&row.work_dir), &relative)?;
            if !target.is_file() {
                return Err(AppError::from("Download file not found"));
            }
            Ok(())
        })
        .await?;
        let guard = self.engine.lock().await;
        let server = guard
            .as_ref()
            .and_then(|engine| engine.stream_server.as_ref())
            .ok_or_else(|| AppError::from("BT preview server is unavailable"))?;
        Ok(BtFilePreview {
            url: server.file_url(info_hash, &path),
            partial,
        })
    }

    pub async fn open_file(&self, info_hash: &str, path: String) -> AppResult<()> {
        parse_info_hash(info_hash)?;
        let row = self
            .storage
            .get_bt_task(info_hash)?
            .ok_or_else(|| AppError::from("Download task not found"))?;
        let app = self.app.clone();
        run_blocking(move || {
            let target = resolve_path(Path::new(&row.work_dir), &path)?;
            if !target.is_file() {
                return Err(AppError::from("Download file not found"));
            }
            crate::file_opener::open(&app, &target)
        })
        .await
    }
}

#[cfg(test)]
#[path = "files_tests.rs"]
mod tests;
