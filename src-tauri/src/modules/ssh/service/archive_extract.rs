use super::archive::archive_entry_target;
use super::transfer_models::TransferReader;
use super::types::{Manager, TransferGuard};
use crate::error::{AppError, AppResult, CustomErrorCode};
use std::ffi::OsString;
use std::fs;
use std::path::{Component, Path, PathBuf};

impl Manager {
    pub(super) fn extract_download(
        &self,
        archive: &Path,
        destination: &Path,
        transfer: Option<&TransferGuard>,
    ) -> AppResult<()> {
        let parent = destination
            .parent()
            .filter(|path| !path.as_os_str().is_empty())
            .unwrap_or(Path::new("."));
        fs::create_dir_all(parent)?;
        let staging = parent.join(format!(".mftp-extract-{}", uuid::Uuid::new_v4()));
        // Exclusive creation establishes ownership before the directory enters
        // the recovery journal. Never register/delete an existing user path.
        fs::create_dir(&staging)?;
        let _cleanup = match self.track_local_temp(staging.clone()) {
            Ok(cleanup) => cleanup,
            Err(error) => {
                let _ = fs::remove_dir(&staging);
                return Err(error);
            }
        };
        let contents = extract_clean_tar_gz(archive, &staging, transfer)?;
        if let Some(transfer) = transfer {
            transfer.check()?;
        }
        publish_directory(&contents, destination, transfer)
    }
}

fn unsafe_path(path: &Path) -> AppError {
    AppError::custom(CustomErrorCode::SftpArchiveUnsafePath).with_arg("path", path.display())
}

fn extract_clean_tar_gz(
    archive: &Path,
    staging: &Path,
    transfer: Option<&TransferGuard>,
) -> AppResult<PathBuf> {
    let decoder = flate2::read::GzDecoder::new(TransferReader {
        inner: fs::File::open(archive)?,
        transfer,
    });
    let mut archive = tar::Archive::new(decoder);
    let mut root: Option<OsString> = None;
    for entry in archive.entries()? {
        if let Some(transfer) = transfer {
            transfer.check()?;
        }
        let mut entry = entry?;
        let path = entry.path()?.into_owned();
        if archive_entry_target(staging, &path)?.is_none() {
            continue;
        }
        let mut names = path.components().filter_map(|component| match component {
            Component::Normal(name) => Some(name),
            _ => None,
        });
        let Some(top) = names.next() else {
            return Err(unsafe_path(&path));
        };
        if root.as_ref().is_some_and(|root| root != top) {
            return Err(unsafe_path(&path));
        }
        root = Some(top.to_owned());
        let kind = entry.header().entry_type();
        if names.next().is_none() && !kind.is_dir() {
            return Err(unsafe_path(&path));
        }
        if !(kind.is_file() || kind.is_dir() || kind.is_symlink() || kind.is_hard_link()) {
            return Err(AppError::custom(CustomErrorCode::SftpUnsupportedFile));
        }
        // Preserve original archive paths until unpacking ends. tar's bounded
        // unpack checks symlink ancestors and hard-link sources; raw unpack on
        // a manually stripped path would bypass those protections.
        if !entry.unpack_in(staging)? {
            return Err(unsafe_path(&path));
        }
    }
    // tar may stop at its end marker before gzip verifies the trailer. Drain
    // the decoder so corrupt/truncated archives never reach publication.
    std::io::copy(&mut archive.into_inner(), &mut std::io::sink())?;
    let contents = staging.join(root.unwrap_or_else(|| OsString::from("contents")));
    if !contents.exists() {
        fs::create_dir(&contents)?;
    }
    if !fs::symlink_metadata(&contents)?.is_dir() {
        return Err(unsafe_path(&contents));
    }
    Ok(contents)
}

fn publish_directory(
    source: &Path,
    destination: &Path,
    transfer: Option<&TransferGuard>,
) -> AppResult<()> {
    if let Some(transfer) = transfer {
        transfer.check()?;
    }
    match fs::symlink_metadata(destination) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::rename(source, destination)?;
            return Ok(());
        }
        Err(error) => return Err(error.into()),
        Ok(metadata) if !metadata.is_dir() => return Err(unsafe_path(destination)),
        Ok(_) => {}
    }
    // Existing directory downloads retain merge/overwrite behavior. Extraction
    // has already succeeded; a later disk/commit failure leaves completed user
    // entries in place, never deletes their destination as a rollback shortcut.
    for entry in fs::read_dir(source)? {
        if let Some(transfer) = transfer {
            transfer.check()?;
        }
        let entry = entry?;
        let destination = destination.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            publish_directory(&entry.path(), &destination, transfer)?;
        } else {
            if fs::symlink_metadata(&destination).is_ok_and(|metadata| metadata.is_dir()) {
                return Err(AppError::custom(CustomErrorCode::SftpTargetIsDirectory)
                    .with_arg("path", destination.display()));
            }
            // Same-filesystem rename replaces the leaf without following an
            // existing symlink or deleting the old file before a failed rename.
            fs::rename(entry.path(), destination)?;
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "archive_extract_tests.rs"]
mod tests;
