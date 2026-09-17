//! Hidden staging directories: the `.mftp-part` folder a download fills in
//! before it is renamed into place, and the ownership-checked cleanup that
//! removes it without ever touching a directory the user owns.

use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};
use crate::storage::bt::BtTaskRow;

pub(super) const PART_DIR_NAME: &str = ".mftp-part";

pub(super) fn part_root(dest_dir: &Path) -> PathBuf {
    dest_dir.join(PART_DIR_NAME)
}

pub(super) fn part_dir_for(dest_dir: &Path, info_hash: &str) -> PathBuf {
    part_root(dest_dir).join(info_hash)
}

/// Whether this row downloads into its own part dir. False for preview rows
/// (they own a cache dir), for archive rows (they stage in app data), and for
/// rows created before staging existed — those keep finishing in place.
pub(super) fn stages_into_part_dir(row: &BtTaskRow) -> bool {
    row.mode == "download" && row.package_mode == "direct" && row.work_dir != row.dest_dir
}

/// Drop a plain download's part dir, then the part root if this was the last
/// task using it, so the destination folder is left holding only the file.
pub(super) fn remove_part_dir(row: &BtTaskRow) -> AppResult<()> {
    let root = part_root(Path::new(&row.dest_dir));
    remove_owned_hash_dir(&root, Path::new(&row.work_dir), &row.info_hash)?;
    let _ = std::fs::remove_dir(&root);
    Ok(())
}

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
