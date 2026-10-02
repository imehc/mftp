use super::upload_request::{Conflict, UploadRequest};
use crate::error::{AppError, AppResult, CustomErrorCode};
use std::fs::{File, Metadata, OpenOptions};
use std::io::{ErrorKind, Seek, SeekFrom};
use std::path::{Path, PathBuf};

pub(super) struct UploadFile {
    pub file: File,
    pub name: String,
}

pub(super) fn open(root: &Path, request: &UploadRequest) -> AppResult<UploadFile> {
    let path = destination(root, &request.relative, true)?.ok_or_else(invalid_target)?;
    let parent = path.parent().ok_or_else(invalid_target)?;
    let available = fs2::available_space(parent)?;
    if available < request.length {
        return Err(
            AppError::custom(CustomErrorCode::LanUploadSpaceInsufficient)
                .with_arg("required", request.length)
                .with_arg("available", available),
        );
    }
    let (mut file, path) = if request.conflict == Conflict::Rename {
        create_renamed(&path)?
    } else {
        (open_existing_or_new(&path, request.start)?, path)
    };
    // Lock before checking length or truncating. Concurrent resume/overwrite must
    // fail without touching the bytes owned by the current upload worker.
    fs2::FileExt::try_lock_exclusive(&file).map_err(|error| {
        if error.raw_os_error() == fs2::lock_contended_error().raw_os_error() {
            AppError::custom(CustomErrorCode::LanUploadTargetBusy)
        } else {
            AppError::from(error)
        }
    })?;
    let metadata = file.metadata()?;
    if !metadata.is_file() {
        return Err(invalid_target());
    }
    if request.conflict != Conflict::Overwrite && metadata.len() != request.start {
        return Err(offset_mismatch(metadata.len(), request.start));
    }
    if request.conflict == Conflict::Overwrite {
        file.set_len(0)?;
    }
    file.seek(SeekFrom::Start(request.start))?;
    let relative = request
        .relative
        .with_file_name(path.file_name().ok_or_else(invalid_target)?);
    Ok(UploadFile {
        file,
        name: relative.to_string_lossy().into_owned(),
    })
}

fn open_existing_or_new(path: &Path, start: u64) -> AppResult<File> {
    if let Some(metadata) = existing_metadata(path)? {
        if !metadata.is_file() {
            return Err(invalid_target());
        }
        return Ok(OpenOptions::new().read(true).write(true).open(path)?);
    }
    if start != 0 {
        return Err(offset_mismatch(0, start));
    }
    // A race with another creator returns AlreadyExists; never fall back to truncate.
    Ok(OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .open(path)?)
}

fn create_renamed(path: &Path) -> AppResult<(File, PathBuf)> {
    let stem = path
        .file_stem()
        .ok_or_else(invalid_target)?
        .to_string_lossy();
    let extension = path
        .extension()
        .map(|value| format!(".{}", value.to_string_lossy()))
        .unwrap_or_default();
    // Keep familiar numbered names, then bound collision probes with a UUID.
    for index in 0..=1000 {
        let candidate = match index {
            0 => path.to_path_buf(),
            1000 => path.with_file_name(format!("{stem}-{}{extension}", uuid::Uuid::new_v4())),
            _ => path.with_file_name(format!("{stem} ({index}){extension}")),
        };
        match OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(file) => return Ok((file, candidate)),
            Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
        }
    }
    Err(AppError::custom(CustomErrorCode::LanUploadTargetBusy))
}

pub(super) fn destination(
    root: &Path,
    relative: &Path,
    create: bool,
) -> AppResult<Option<PathBuf>> {
    if create {
        std::fs::create_dir_all(root)?;
    }
    let mut parent = match std::fs::canonicalize(root) {
        Ok(path) => path,
        Err(error) if !create && error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    if !std::fs::metadata(&parent)?.is_dir() {
        return Err(invalid_target());
    }
    for part in relative.parent().ok_or_else(invalid_target)?.components() {
        parent.push(part);
        if create {
            match std::fs::create_dir(&parent) {
                Ok(()) => {}
                Err(error) if error.kind() == ErrorKind::AlreadyExists => {}
                Err(error) => return Err(error.into()),
            }
        }
        match existing_metadata(&parent)? {
            Some(metadata) if metadata.is_dir() => {}
            Some(_) => return Err(invalid_target()),
            None => return Ok(None),
        }
    }
    Ok(Some(
        parent.join(relative.file_name().ok_or_else(invalid_target)?),
    ))
}

pub(super) fn existing_metadata(path: &Path) -> AppResult<Option<Metadata>> {
    match std::fs::symlink_metadata(path) {
        // Do not follow upload targets or parent links outside the chosen root.
        Ok(metadata) if metadata.file_type().is_symlink() => Err(invalid_target()),
        Ok(metadata) => Ok(Some(metadata)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn invalid_target() -> AppError {
    AppError::custom(CustomErrorCode::LanUploadTargetInvalid)
}
fn offset_mismatch(actual: u64, expected: u64) -> AppError {
    AppError::custom(CustomErrorCode::LanUploadOffsetMismatch)
        .with_arg("actual", actual)
        .with_arg("expected", expected)
}

#[cfg(test)]
#[path = "upload_file_tests.rs"]
mod tests;
