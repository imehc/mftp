use super::super::ports::emit_progress;
use super::super::ports::EventSink;
use super::transfer_models::{archive_total_file_bytes, should_skip_archive_path, ProgressReader};
use super::types::TransferGuard;
use crate::error::{AppError, AppResult, CustomErrorCode};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use walkdir::WalkDir;

pub(super) fn pack_clean_tar_gz(
    local_dir: &str,
    top_name: &str,
    dest: &Path,
    events: Option<&EventSink>,
    transfer_id: Option<&str>,
    transfer: Option<&TransferGuard>,
) -> AppResult<()> {
    use flate2::write::GzEncoder;
    use flate2::Compression;
    use tar::Header;

    let root = Path::new(local_dir);
    if !root.is_dir() {
        return Err(AppError::custom(CustomErrorCode::SftpNotDirectory));
    }

    emit_progress(events, transfer_id, "扫描文件中", 0, None);
    let total = archive_total_file_bytes(local_dir)?;
    let total_for_progress = if total == 0 { Some(1) } else { Some(total) };
    let mut transferred = 0u64;
    let mut last_emit = Instant::now();
    emit_progress(events, transfer_id, "压缩中", 0, total_for_progress);

    let file = std::fs::File::create(dest)?;
    let enc = GzEncoder::new(file, Compression::fast());
    let mut builder = tar::Builder::new(enc);
    builder.follow_symlinks(false);

    let mut iter = WalkDir::new(root).follow_links(false).into_iter();
    while let Some(entry) = iter.next() {
        if let Some(transfer) = transfer {
            transfer.check()?;
        }
        let entry = entry.map_err(|e| AppError::from(e).context("Packing archive"))?;
        let local = entry.path();
        let relative = local.strip_prefix(root).unwrap_or(Path::new(""));
        if !relative.as_os_str().is_empty() && should_skip_archive_path(relative) {
            if entry.file_type().is_dir() {
                iter.skip_current_dir();
            }
            continue;
        }

        let archive_path = if relative.as_os_str().is_empty() {
            PathBuf::from(top_name)
        } else {
            Path::new(top_name).join(relative)
        };

        if entry.file_type().is_file() {
            let mut file = std::fs::File::open(local)?;
            let meta = file.metadata()?;
            let mut header = Header::new_gnu();
            header.set_metadata(&meta);
            header.set_size(meta.len());
            let reader = ProgressReader {
                inner: &mut file,
                events,
                transfer_id,
                phase: "压缩中",
                transferred: &mut transferred,
                total: total_for_progress,
                last_emit: &mut last_emit,
                transfer,
            };
            if let Err(error) = builder.append_data(&mut header, &archive_path, reader) {
                if let Some(transfer) = transfer {
                    transfer.check()?;
                }
                return Err(AppError::from(error).context("Packing archive"));
            }
            if last_emit.elapsed() >= Duration::from_millis(120) {
                emit_progress(
                    events,
                    transfer_id,
                    "压缩中",
                    transferred,
                    total_for_progress,
                );
                last_emit = Instant::now();
            }
        } else {
            builder
                .append_path_with_name(local, &archive_path)
                .map_err(|e| AppError::from(e).context("Packing archive"))?;
        }
    }

    let enc = builder
        .into_inner()
        .map_err(|e| AppError::from(e).context("Packing archive"))?;
    enc.finish()
        .map_err(|e| AppError::from(e).context("Packing archive"))?;
    emit_progress(
        events,
        transfer_id,
        "压缩中",
        total_for_progress.unwrap_or(1),
        total_for_progress,
    );
    Ok(())
}

pub(super) fn archive_entry_target(base: &Path, path: &Path) -> AppResult<Option<PathBuf>> {
    use std::path::Component;

    if should_skip_archive_path(path) {
        return Ok(None);
    }

    let mut components = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(value) => components.push(value.to_os_string()),
            Component::CurDir => {}
            _ => {
                return Err(AppError::custom(CustomErrorCode::SftpArchiveUnsafePath)
                    .with_arg("path", path.display()))
            }
        }
    }

    if components.is_empty() {
        return Ok(Some(base.to_path_buf()));
    }

    let tail = if components.len() > 1 {
        &components[1..]
    } else {
        &components[0..0]
    };
    let mut target = base.to_path_buf();
    for component in tail {
        target.push(component);
    }
    Ok(Some(target))
}

#[cfg(test)]
#[path = "archive_tests.rs"]
mod tests;
