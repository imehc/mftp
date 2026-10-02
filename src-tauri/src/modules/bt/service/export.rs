//! Blocking filesystem work for BT exports and archive finalization.

use std::fs::{File, OpenOptions};
use std::io::{BufReader, BufWriter, Read, Result as IoResult, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use super::{BtManager, BtTaskInfo, TorrentHandle};
use crate::error::{AppError, AppResult, CustomErrorCode};

#[derive(Clone)]
pub(super) struct ExportFile {
    pub absolute: PathBuf,
    pub relative: PathBuf,
    pub len: u64,
}

pub(super) fn selected_export_files(
    handle: &TorrentHandle,
    file_indices: &[usize],
) -> AppResult<Vec<ExportFile>> {
    let output = handle.output_folder().to_path_buf();
    let selected = (!file_indices.is_empty()).then(|| {
        file_indices
            .iter()
            .copied()
            .collect::<std::collections::HashSet<_>>()
    });
    let files = handle
        .with_metadata(|meta| {
            meta.file_infos
                .iter()
                .enumerate()
                .filter(|(index, info)| {
                    !info.attrs.padding
                        && selected
                            .as_ref()
                            .map(|items| items.contains(index))
                            .unwrap_or(true)
                })
                .map(|(_, info)| ExportFile {
                    absolute: output.join(&info.relative_filename),
                    relative: info.relative_filename.clone(),
                    len: info.len,
                })
                .collect::<Vec<_>>()
        })
        .map_err(AppError::bt_engine)?;
    if files.is_empty() {
        return Err(AppError::custom(CustomErrorCode::BtNoExportableFiles));
    }
    Ok(files)
}

pub(super) fn copy_path_to_dir(
    source: &Path,
    dest_dir: &Path,
    fallback_name: &str,
) -> AppResult<PathBuf> {
    let target = unique_path(dest_dir, fallback_name);
    copy_without_overwrite(source, &target)?;
    Ok(target)
}

fn copy_without_overwrite(source: &Path, target: &Path) -> AppResult<()> {
    let mut input = File::open(source)
        .map_err(|error| AppError::from(error).context("Open BT export source"))?;
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(target)
        .map_err(|error| AppError::from(error).context("Create BT export destination"))?;
    // Only a file created by this operation may be removed after a failed copy.
    // A create_new collision must never delete the pre-existing destination.
    let result = (|| -> AppResult<()> {
        std::io::copy(&mut input, &mut output)
            .map_err(|error| AppError::from(error).context("Copy BT export"))?;
        output
            .sync_all()
            .map_err(|error| AppError::from(error).context("Flush BT export"))?;
        Ok(())
    })();
    drop(output);
    if let Err(error) = result {
        let _ = remove_file_if_exists(target);
        return Err(error);
    }
    Ok(())
}

pub(super) fn archive_target(dest_dir: &Path, label: &str) -> PathBuf {
    unique_path(dest_dir, &format!("{}.tar", sanitize_name(label)))
}

pub(super) fn partial_archive_path(target: &Path, info_hash: &str) -> AppResult<PathBuf> {
    let name = target
        .file_name()
        .ok_or_else(|| AppError::custom(CustomErrorCode::BtInvalidArchivePath))?
        .to_string_lossy();
    Ok(target.with_file_name(format!(".{name}.{info_hash}.mftp-part")))
}

pub(super) fn pack_tar(
    files: &[ExportFile],
    target: &Path,
    cancelled: &AtomicBool,
) -> AppResult<()> {
    const ARCHIVE_BUFFER_SIZE: usize = 1024 * 1024;
    let file =
        File::create(target).map_err(|error| AppError::from(error).context("Create BT archive"))?;
    let writer = BufWriter::with_capacity(ARCHIVE_BUFFER_SIZE, file);
    let mut archive = tar::Builder::new(writer);
    archive.follow_symlinks(false);
    for item in files {
        if cancelled.load(Ordering::SeqCst) {
            return Err(AppError::custom(CustomErrorCode::BtTaskCancelled));
        }
        let source = File::open(&item.absolute)
            .map_err(|error| AppError::from(error).context("Open BT archive source"))?;
        let source = BufReader::with_capacity(ARCHIVE_BUFFER_SIZE, source);
        let mut header = tar::Header::new_gnu();
        header.set_size(item.len);
        header.set_mode(0o644);
        header.set_cksum();
        archive
            .append_data(
                &mut header,
                &item.relative,
                CancelReader { source, cancelled },
            )
            .map_err(|error| AppError::from(error).context("Append BT archive entry"))?;
    }
    let mut writer = archive
        .into_inner()
        .map_err(|error| AppError::from(error).context("Write BT archive"))?;
    writer
        .flush()
        .map_err(|error| AppError::from(error).context("Write BT archive"))?;
    Ok(())
}

pub(super) fn remove_file_if_exists(path: &Path) -> AppResult<()> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(AppError::from(error).context("Remove BT file")),
    }
}

fn sanitize_name(label: &str) -> String {
    let cleaned: String = label
        .chars()
        .map(|character| {
            if character.is_control() || "/\\:*?\"<>|".contains(character) {
                '_'
            } else {
                character
            }
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.');
    if trimmed.is_empty() {
        "bt-download".into()
    } else {
        trimmed.to_string()
    }
}

impl BtManager {
    pub async fn export_task(
        &self,
        info_hash: &str,
        requested_dir: String,
    ) -> AppResult<BtTaskInfo> {
        let (info_hash, operation) = self.task_operation(info_hash).await?;
        let info_hash = info_hash.as_str();
        let hash = super::parse_info_hash(info_hash)?;
        let session = self.ensure_engine().await?;
        let publication = self.finalize_gate.clone().lock_owned().await;
        let row = self
            .repository
            .get_bt_task(info_hash)?
            .ok_or_else(|| AppError::custom(CustomErrorCode::BtTaskNotFound))?;
        if row.status != "completed" {
            return Err(AppError::custom(CustomErrorCode::BtExportNotCompleted));
        }
        if row
            .export_path
            .as_deref()
            .is_some_and(|path| Path::new(path).is_file())
        {
            return Err(AppError::custom(CustomErrorCode::BtExportAlreadyDone));
        }
        let source = row
            .output_path
            .as_deref()
            .map(PathBuf::from)
            .filter(|path| path.is_file())
            .ok_or_else(|| AppError::custom(CustomErrorCode::BtFileNotFound))?;
        let target_dir = if requested_dir.trim().is_empty() {
            self.files.download_dir()?
        } else {
            PathBuf::from(requested_dir.trim())
        };
        let directory = target_dir.clone();
        operation
            .blocking(move || {
                std::fs::create_dir_all(directory)
                    .map_err(|error| AppError::from(error).context("Create BT export directory"))
            })
            .await?;
        if super::find_handle(&session, &hash)?.is_some() {
            session.delete(hash.into(), false).await.map_err(|error| {
                AppError::external("bt:engine", format!("Failed to stop BT task: {error:#}"))
            })?;
        }
        let repository = self.repository.clone();
        let events = self.events.clone();
        let info_hash = info_hash.to_owned();
        let updated = operation
            .blocking(move || {
                // Keep publication and task admission through copy, persistence and
                // notification even if the originating IPC future is dropped.
                let _publication = publication;
                let filename = source
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("bt-download");
                let target = copy_path_to_dir(&source, &target_dir, filename)?;
                let target_string = target.to_string_lossy().into_owned();
                repository.set_bt_task_export_path(&info_hash, &target_string)?;
                super::super::ports::emit_task(
                    &events,
                    super::BtTaskEvent::ExportCompleted {
                        info_hash: info_hash.clone(),
                    },
                );
                repository
                    .get_bt_task(&info_hash)?
                    .ok_or_else(|| AppError::custom(CustomErrorCode::BtTaskNotFound))
            })
            .await?;
        Ok(self.task_info_with_live(updated))
    }
}

fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let candidate = dir.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let (stem, extension) = match name.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() => (stem.to_string(), format!(".{extension}")),
        _ => (name.to_string(), String::new()),
    };
    for number in 2..1000 {
        let candidate = dir.join(format!("{stem} ({number}){extension}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    dir.join(format!("{stem} ({}){extension}", crate::storage::now_ms()))
}

struct CancelReader<'a, R> {
    source: R,
    cancelled: &'a AtomicBool,
}

impl<R: Read> Read for CancelReader<'_, R> {
    fn read(&mut self, buffer: &mut [u8]) -> IoResult<usize> {
        if self.cancelled.load(Ordering::SeqCst) {
            // Interrupted tells std::io::copy to retry forever. Cancellation is
            // terminal and carries the full application error through tar's IO.
            return Err(std::io::Error::other(AppError::custom(
                CustomErrorCode::BtTaskCancelled,
            )));
        }
        self.source.read(buffer)
    }
}

#[cfg(test)]
#[path = "export_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "export_lifecycle_tests.rs"]
mod lifecycle_tests;
