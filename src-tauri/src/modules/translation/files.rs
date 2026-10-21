use super::catalog::{self, ModelSpec};
use crate::error::{AppError, AppResult, CustomErrorCode};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Serialize, Deserialize)]
struct Selection {
    version: u32,
    selected: String,
}

pub(super) fn cancelled(cancel: &AtomicBool) -> AppResult<()> {
    if cancel.load(Ordering::Acquire) {
        Err(AppError::custom(CustomErrorCode::TranslationCancelled))
    } else {
        Ok(())
    }
}

pub(super) fn model_path(root: &Path, model: &ModelSpec) -> PathBuf {
    root.join(format!("{}.gguf", model.sha256))
}

pub(super) fn partial_path(root: &Path, model: &ModelSpec) -> PathBuf {
    root.join(format!("{}.part", model.sha256))
}

pub(super) fn size(path: &Path) -> AppResult<Option<u64>> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_file() => Ok(Some(metadata.len())),
        Ok(_) => Err(AppError::custom(
            CustomErrorCode::TranslationResourceInvalid,
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

pub(super) fn selected(root: &Path) -> AppResult<String> {
    match fs::read(root.join("selection.json")) {
        Ok(bytes) => {
            let selection: Selection = serde_json::from_slice(&bytes)?;
            if selection.version != 1 {
                return Err(AppError::custom(
                    CustomErrorCode::TranslationResourceInvalid,
                ));
            }
            catalog::find_any(&selection.selected)?;
            if catalog::find(&selection.selected).is_ok() {
                Ok(selection.selected)
            } else {
                Ok(catalog::default_id().into())
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(catalog::default_id().into())
        }
        Err(error) => Err(error.into()),
    }
}

pub(super) fn select(root: &Path, id: &str) -> AppResult<()> {
    catalog::find(id)?;
    let bytes = serde_json::to_vec(&Selection {
        version: 1,
        selected: id.into(),
    })?;
    let temp = root.join(format!("selection-{}.tmp", uuid::Uuid::new_v4()));
    let mut file = File::options().write(true).create_new(true).open(&temp)?;
    file.write_all(&bytes)?;
    file.sync_all()?;
    // The destination is our own small preference record, never a model or user file.
    fs::rename(&temp, root.join("selection.json"))?;
    Ok(())
}

pub(super) fn verify(path: &Path, spec: &ModelSpec, cancel: &AtomicBool) -> AppResult<()> {
    if size(path)? != Some(spec.bytes) {
        return Err(AppError::custom(
            CustomErrorCode::TranslationResourceInvalid,
        ));
    }
    let mut file = File::open(path)?;
    let mut hash = Sha256::new();
    let mut buffer = vec![0; 256 * 1024];
    loop {
        cancelled(cancel)?;
        let length = file.read(&mut buffer)?;
        if length == 0 {
            break;
        }
        hash.update(&buffer[..length]);
    }
    let digest = hash
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    if digest != spec.sha256 {
        return Err(AppError::custom(CustomErrorCode::TranslationChecksum));
    }
    Ok(())
}

pub(super) fn verified_path(path: &Path) -> PathBuf {
    path.with_extension("verified")
}

/// Publishes a fully written, verified partial download as the installed model.
///
/// A hard link publishes without clobbering an artifact another run already
/// installed, but some Android devices deny `link()` inside app-private storage
/// and report `EACCES`. Renaming inside the same directory is the portable
/// fallback: it is atomic, and the content digest in the file name means both
/// paths would refer to identical bytes anyway.
///
/// Returns `false` when the destination was already published, so the caller
/// verifies the existing artifact instead of trusting it.
pub(super) fn publish(partial: &Path, destination: &Path) -> AppResult<bool> {
    match fs::hard_link(partial, destination) {
        Ok(()) => {
            fs::remove_file(partial)?;
            Ok(true)
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            // The same digest is already installed; the partial copy is redundant.
            fs::remove_file(partial)?;
            Ok(false)
        }
        Err(_) => {
            fs::rename(partial, destination)
                .map_err(|error| AppError::from(error).context("publish translation model"))?;
            Ok(true)
        }
    }
}

fn stamp(path: &Path) -> AppResult<String> {
    let metadata = fs::symlink_metadata(path)?;
    let modified = metadata
        .modified()?
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |time| time.as_nanos());
    Ok(format!("{}:{modified}", metadata.len()))
}

/// Hashes the whole file only when its size or mtime changed since the last successful check.
pub(super) fn verify_once(path: &Path, spec: &ModelSpec, cancel: &AtomicBool) -> AppResult<()> {
    let marker = verified_path(path);
    // Taken before hashing so a write during verification invalidates the marker.
    let current = stamp(path)?;
    if fs::read_to_string(&marker).is_ok_and(|recorded| recorded == current) {
        return Ok(());
    }
    verify(path, spec, cancel)?;
    fs::write(marker, current)?;
    Ok(())
}

/// Records a file that was just hashed by `verify`, e.g. a freshly published download.
pub(super) fn mark_verified(path: &Path) -> AppResult<()> {
    fs::write(verified_path(path), stamp(path)?)?;
    Ok(())
}

pub(super) fn prepare(root: &Path) -> AppResult<()> {
    fs::create_dir_all(root)?;
    #[cfg(target_os = "ios")]
    {
        use objc2_foundation::{NSNumber, NSString, NSURLIsExcludedFromBackupKey, NSURL};
        let path = root
            .to_str()
            .ok_or_else(|| AppError::custom(CustomErrorCode::TranslationResourceInvalid))?;
        let url = NSURL::fileURLWithPath_isDirectory(&NSString::from_str(path), true);
        let value = NSNumber::new_bool(true);
        unsafe { url.setResourceValue_forKey_error(Some(&value), NSURLIsExcludedFromBackupKey) }
            .map_err(|error| AppError::external("translation:backup", error.to_string()))?;
    }
    Ok(())
}
