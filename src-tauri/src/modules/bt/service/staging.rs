//! Ownership-checked cleanup for application-private BT download directories.

use std::path::Path;

use crate::error::{AppError, AppResult, CustomErrorCode};

pub(super) fn remove_owned_hash_dir(
    root: &Path,
    candidate: &Path,
    info_hash: &str,
) -> AppResult<()> {
    if candidate.parent() != Some(root)
        || candidate.file_name().and_then(|name| name.to_str()) != Some(info_hash)
    {
        return Err(AppError::custom(CustomErrorCode::BtStagingDirForeign));
    }
    match std::fs::remove_dir_all(candidate) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(AppError::from(error).context("Cleanup BT staging directory")),
    }
}

#[cfg(test)]
#[path = "staging_tests.rs"]
mod tests;
