//! Ownership-checked cleanup for application-private BT download directories.

use std::path::Path;

use crate::error::{AppError, AppResult};

pub(super) fn remove_owned_hash_dir(
    root: &Path,
    candidate: &Path,
    info_hash: &str,
) -> AppResult<()> {
    if candidate.parent() != Some(root)
        || candidate.file_name().and_then(|name| name.to_str()) != Some(info_hash)
    {
        return Err(AppError("拒绝清理非 BT 自有目录".into()));
    }
    match std::fs::remove_dir_all(candidate) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(AppError(format!("清理 BT 暂存目录失败: {error}"))),
    }
}

#[cfg(test)]
#[path = "staging_tests.rs"]
mod tests;
