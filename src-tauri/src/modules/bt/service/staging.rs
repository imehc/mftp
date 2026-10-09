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

// Query ownership before touching disk. A failed read cannot authorize deletion.
pub(super) fn cleanup_orphans(
    repository: &crate::modules::bt::repository::BtRepository,
    root: &Path,
    mut referenced: std::collections::HashSet<std::path::PathBuf>,
) -> AppResult<()> {
    for row in repository.list_bt_tasks()? {
        if row.dest_dir.is_empty() {
            referenced.insert(row.work_dir.into());
        }
    }
    let entries = match std::fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    for entry in entries {
        let entry = entry?;
        let path = entry.path();
        let Some(hash) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if super::parse_info_hash(hash).is_ok()
            && entry.file_type()?.is_dir()
            && !referenced.contains(&path)
        {
            remove_owned_hash_dir(root, &path, hash)?;
        }
    }
    Ok(())
}
