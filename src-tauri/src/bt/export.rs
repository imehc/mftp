//! Blocking filesystem work for BT exports and archive finalization.

use std::fs::{File, OpenOptions};
use std::io::{BufReader, BufWriter, Read, Result as IoResult, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use super::{BtManager, BtTaskInfo, TorrentHandle};
use crate::error::{AppError, AppResult};
use anyhow::Context as _;
use tauri::Manager as _;

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
        .map_err(|error| AppError(format!("资源信息未就绪: {error:#}")))?;
    if files.is_empty() {
        return Err(AppError("没有可转存的文件".into()));
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
    let result = (|| {
        let mut input = File::open(source).with_context(|| format!("打开 {}", source.display()))?;
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(target)
            .with_context(|| format!("创建 {}", target.display()))?;
        std::io::copy(&mut input, &mut output)
            .with_context(|| format!("复制 {}", source.display()))?;
        output
            .sync_all()
            .with_context(|| format!("写入 {}", target.display()))?;
        Ok::<(), anyhow::Error>(())
    })();
    if let Err(error) = result {
        let _ = remove_file_if_exists(target);
        return Err(AppError(format!("{error:#}")));
    }
    Ok(())
}

pub(super) fn archive_target(dest_dir: &Path, label: &str) -> PathBuf {
    unique_path(dest_dir, &format!("{}.tar", sanitize_name(label)))
}

pub(super) fn partial_archive_path(target: &Path, info_hash: &str) -> AppResult<PathBuf> {
    let name = target
        .file_name()
        .ok_or_else(|| AppError("压缩包路径无效".into()))?
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
        File::create(target).map_err(|error| AppError(format!("创建压缩包失败: {error}")))?;
    let writer = BufWriter::with_capacity(ARCHIVE_BUFFER_SIZE, file);
    let mut archive = tar::Builder::new(writer);
    archive.follow_symlinks(false);
    for item in files {
        if cancelled.load(Ordering::SeqCst) {
            return Err(AppError("任务已取消".into()));
        }
        let source = File::open(&item.absolute)
            .with_context(|| format!("打开 {}", item.absolute.display()))
            .map_err(|error| AppError(format!("{error:#}")))?;
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
            .with_context(|| format!("打包 {}", item.absolute.display()))
            .map_err(|error| AppError(format!("{error:#}")))?;
    }
    let mut writer = archive
        .into_inner()
        .map_err(|error| AppError(format!("写入压缩包失败: {error}")))?;
    writer
        .flush()
        .map_err(|error| AppError(format!("写入压缩包失败: {error}")))?;
    Ok(())
}

pub(super) fn remove_file_if_exists(path: &Path) -> AppResult<()> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(AppError(format!("删除文件失败: {error}"))),
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
        let hash = super::parse_info_hash(info_hash)?;
        let session = self.ensure_engine().await?;
        let _guard = self.finalize_gate.lock().await;
        let row = self
            .storage
            .get_bt_task(info_hash)?
            .ok_or_else(|| AppError("任务不存在".into()))?;
        if row.status != "completed" {
            return Err(AppError("任务尚未完成，无法转存".into()));
        }
        if row
            .export_path
            .as_deref()
            .is_some_and(|path| Path::new(path).is_file())
        {
            return Err(AppError("任务已经转存".into()));
        }
        let source = row
            .output_path
            .as_deref()
            .map(PathBuf::from)
            .filter(|path| path.is_file())
            .ok_or_else(|| AppError("下载文件不存在，请重新下载".into()))?;
        let target_dir = if requested_dir.trim().is_empty() {
            self.app
                .path()
                .download_dir()
                .map_err(|error| AppError(format!("无法定位系统下载目录: {error}")))?
        } else {
            PathBuf::from(requested_dir.trim())
        };
        std::fs::create_dir_all(&target_dir)
            .map_err(|error| AppError(format!("创建转存目录失败: {error}")))?;

        if super::find_handle(&session, &hash)?.is_some() {
            session
                .delete(hash.into(), false)
                .await
                .map_err(|error| AppError(format!("停止 BT 任务失败: {error:#}")))?;
        }
        let filename = source
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("bt-download");
        let target = copy_path_to_dir(&source, &target_dir, filename)?;
        let target_string = target.to_string_lossy().into_owned();
        self.storage
            .set_bt_task_export_path(info_hash, &target_string)?;
        super::finalize::emit_event(&self.app, info_hash, "export-completed");
        let updated = self
            .storage
            .get_bt_task(info_hash)?
            .ok_or_else(|| AppError("转存后任务不存在".into()))?;
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
            return Err(std::io::Error::new(
                std::io::ErrorKind::Interrupted,
                "archive cancelled",
            ));
        }
        self.source.read(buffer)
    }
}

#[cfg(test)]
#[path = "export_tests.rs"]
mod tests;
