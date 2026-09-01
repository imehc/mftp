//! Blocking filesystem work for BT exports and archive finalization.

use std::fs::{File, OpenOptions};
use std::io::{BufReader, BufWriter, Read, Result as IoResult, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use super::TorrentHandle;
use crate::error::{AppError, AppResult};
use anyhow::Context as _;

#[derive(Clone)]
pub(super) struct ExportFile {
    pub index: usize,
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
                .map(|(index, info)| ExportFile {
                    index,
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

pub(super) fn file_is_complete(handle: &TorrentHandle, file_index: usize) -> AppResult<bool> {
    let len = handle
        .with_metadata(|meta| meta.file_infos.get(file_index).map(|file| file.len))
        .map_err(|error| AppError(format!("资源信息未就绪: {error:#}")))?
        .ok_or_else(|| AppError("文件不存在".into()))?;
    Ok(progress_reaches_len(
        &handle.stats().file_progress,
        file_index,
        len,
    ))
}

pub(super) fn export_files_are_complete(handle: &TorrentHandle, files: &[ExportFile]) -> bool {
    let progress = handle.stats().file_progress;
    files
        .iter()
        .all(|file| progress_reaches_len(&progress, file.index, file.len))
}

fn progress_reaches_len(progress: &[u64], file_index: usize, len: u64) -> bool {
    progress.get(file_index).copied().unwrap_or(0) >= len
}

pub(super) fn copy_export_file(file: &ExportFile, dest_dir: &Path) -> AppResult<PathBuf> {
    let target = unique_path(dest_dir, &export_file_name(file));
    copy_without_overwrite(&file.absolute, &target)?;
    Ok(target)
}

/// Hand a finished file over to the user's folder. The staging directory lives
/// inside that folder, so this is a same-filesystem rename: instant, no second
/// copy of the data. The copy fallback covers the rare case where it is not
/// (a mount point below the download folder).
pub(super) fn move_export_file(file: &ExportFile, dest_dir: &Path) -> AppResult<PathBuf> {
    let target = unique_path(dest_dir, &export_file_name(file));
    if std::fs::rename(&file.absolute, &target).is_ok() {
        return Ok(target);
    }
    copy_without_overwrite(&file.absolute, &target)?;
    let _ = std::fs::remove_file(&file.absolute);
    Ok(target)
}

/// Exports are flat: a single file keeps its own name, never the folder
/// structure the torrent happened to wrap it in.
fn export_file_name(file: &ExportFile) -> String {
    file.relative
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "bt-download".into())
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

pub(super) fn export_files(
    files: &[ExportFile],
    dest_dir: &Path,
    label: &str,
    info_hash: &str,
    cancelled: &AtomicBool,
) -> AppResult<PathBuf> {
    if let [file] = files {
        return copy_export_file(file, dest_dir);
    }
    let target = archive_target(dest_dir, label);
    let partial = partial_archive_path(&target, info_hash)?;
    remove_file_if_exists(&partial)?;
    if let Err(error) = pack_tar(files, &partial, cancelled) {
        let _ = remove_file_if_exists(&partial);
        return Err(error);
    }
    if cancelled.load(Ordering::SeqCst) {
        let _ = remove_file_if_exists(&partial);
        return Err(AppError("任务已取消".into()));
    }
    if target.exists() {
        let _ = remove_file_if_exists(&partial);
        return Err(AppError("目标文件已存在，请重试".into()));
    }
    std::fs::rename(&partial, &target)
        .map_err(|error| AppError(format!("保存压缩包失败: {error}")))?;
    Ok(target)
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
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mftp-bt-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn packs_selected_files_with_relative_paths() {
        let root = temp_dir("pack");
        let first = root.join("first.txt");
        let nested = root.join("nested/second.txt");
        std::fs::create_dir_all(nested.parent().unwrap()).unwrap();
        File::create(&first).unwrap().write_all(b"first").unwrap();
        File::create(&nested).unwrap().write_all(b"second").unwrap();
        let target = root.join("result.tar");
        let files = vec![
            ExportFile {
                index: 0,
                absolute: first,
                relative: "folder/first.txt".into(),
                len: 5,
            },
            ExportFile {
                index: 1,
                absolute: nested,
                relative: "folder/nested/second.txt".into(),
                len: 6,
            },
        ];
        pack_tar(&files, &target, &AtomicBool::new(false)).unwrap();

        let names = tar::Archive::new(File::open(&target).unwrap())
            .entries()
            .unwrap()
            .map(|entry| entry.unwrap().path().unwrap().into_owned())
            .collect::<Vec<_>>();
        assert_eq!(
            names,
            vec![
                PathBuf::from("folder/first.txt"),
                PathBuf::from("folder/nested/second.txt")
            ]
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn tar_suffix_is_preserved_when_choosing_unique_name() {
        let root = temp_dir("unique");
        File::create(root.join("sample.tar")).unwrap();
        assert_eq!(
            unique_path(&root, "sample.tar"),
            root.join("sample (2).tar")
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn single_file_export_keeps_name_and_never_overwrites() {
        let source_root = temp_dir("single-source");
        let destination = temp_dir("single-destination");
        let source = source_root.join("source.bin");
        File::create(&source)
            .unwrap()
            .write_all(b"payload")
            .unwrap();
        File::create(destination.join("source.bin")).unwrap();
        let file = ExportFile {
            index: 0,
            absolute: source,
            relative: "folder/source.bin".into(),
            len: 7,
        };
        let target = copy_export_file(&file, &destination).unwrap();
        assert_eq!(target, destination.join("source (2).bin"));
        assert_eq!(std::fs::read(target).unwrap(), b"payload");
        std::fs::remove_dir_all(source_root).unwrap();
        std::fs::remove_dir_all(destination).unwrap();
    }

    #[test]
    fn cancelled_archive_export_removes_partial_file() {
        let source_root = temp_dir("cancelled-source");
        let destination = temp_dir("cancelled-destination");
        let source = source_root.join("source.bin");
        File::create(&source)
            .unwrap()
            .write_all(b"payload")
            .unwrap();
        let files = vec![
            ExportFile {
                index: 0,
                absolute: source.clone(),
                relative: "source.bin".into(),
                len: 7,
            },
            ExportFile {
                index: 1,
                absolute: source,
                relative: "copy.bin".into(),
                len: 7,
            },
        ];
        let hash = "a".repeat(40);
        let result = export_files(
            &files,
            &destination,
            "cancelled",
            &hash,
            &AtomicBool::new(true),
        );
        assert!(result.is_err());
        assert!(!destination.join("cancelled.tar").exists());
        assert!(!destination
            .join(format!(".cancelled.tar.{hash}.mftp-part"))
            .exists());
        std::fs::remove_dir_all(source_root).unwrap();
        std::fs::remove_dir_all(destination).unwrap();
    }

    #[test]
    fn staged_file_moves_out_without_clobbering_the_folder() {
        let staging = temp_dir("move-staging");
        let destination = temp_dir("move-destination");
        let source = staging.join("source.bin");
        File::create(&source)
            .unwrap()
            .write_all(b"payload")
            .unwrap();
        File::create(destination.join("source.bin")).unwrap();
        let file = ExportFile {
            index: 0,
            absolute: source.clone(),
            relative: "folder/source.bin".into(),
            len: 7,
        };
        let target = move_export_file(&file, &destination).unwrap();
        assert_eq!(target, destination.join("source (2).bin"));
        assert_eq!(std::fs::read(target).unwrap(), b"payload");
        assert!(!source.exists());
        std::fs::remove_dir_all(staging).unwrap();
        std::fs::remove_dir_all(destination).unwrap();
    }

    #[test]
    fn file_completion_uses_the_target_file_progress() {
        let progress = vec![10, 2, 30];
        assert!(progress_reaches_len(&progress, 0, 10));
        assert!(!progress_reaches_len(&progress, 1, 20));
        assert!(progress_reaches_len(&progress, 2, 30));
        assert!(!progress_reaches_len(&progress, 4, 1));
    }
}
