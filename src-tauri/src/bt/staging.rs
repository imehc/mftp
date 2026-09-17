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
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("mftp-bt-path-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn owned_cleanup_removes_only_the_exact_hash_child() {
        let root = temp_dir("owned");
        let hash = "a".repeat(40);
        let owned = root.join(&hash);
        std::fs::create_dir_all(&owned).unwrap();
        remove_owned_hash_dir(&root, &owned, &hash).unwrap();
        assert!(!owned.exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn owned_cleanup_rejects_user_directories() {
        let root = temp_dir("root");
        let user = temp_dir("user");
        let sentinel = user.join("keep.txt");
        std::fs::write(&sentinel, b"keep").unwrap();
        let hash = "b".repeat(40);
        assert!(remove_owned_hash_dir(&root, &user, &hash).is_err());
        assert_eq!(std::fs::read(&sentinel).unwrap(), b"keep");
        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(user).unwrap();
    }

    fn direct_row(dest: &Path, hash: &str) -> BtTaskRow {
        BtTaskRow {
            info_hash: hash.into(),
            label: "movie".into(),
            dest_dir: dest.to_string_lossy().into_owned(),
            mode: "download".into(),
            pinned: false,
            created_at: 1,
            work_dir: part_root(dest).join(hash).to_string_lossy().into_owned(),
            file_indices: vec![0],
            package_mode: "direct".into(),
            status: "active".into(),
            output_path: None,
            total_bytes: Some(7),
            last_error: None,
        }
    }

    #[test]
    fn part_dir_hides_downloads_inside_the_destination() {
        let dest = temp_dir("part");
        let hash = "c".repeat(40);
        let row = direct_row(&dest, &hash);
        assert!(stages_into_part_dir(&row));
        assert_eq!(
            PathBuf::from(&row.work_dir),
            dest.join(".mftp-part").join(&hash)
        );
        std::fs::remove_dir_all(dest).unwrap();
    }

    #[test]
    fn legacy_rows_keep_finishing_in_place() {
        let dest = temp_dir("legacy");
        let hash = "d".repeat(40);
        let mut row = direct_row(&dest, &hash);
        row.work_dir = row.dest_dir.clone();
        assert!(!stages_into_part_dir(&row));
        std::fs::remove_dir_all(dest).unwrap();
    }

    #[test]
    fn publishing_removes_the_part_dir_and_its_root() {
        let dest = temp_dir("publish");
        let hash = "e".repeat(40);
        let row = direct_row(&dest, &hash);
        std::fs::create_dir_all(&row.work_dir).unwrap();
        std::fs::write(Path::new(&row.work_dir).join("movie.mp4"), b"payload").unwrap();
        remove_part_dir(&row).unwrap();
        assert!(!dest.join(".mftp-part").exists());
        assert!(dest.exists());
        std::fs::remove_dir_all(dest).unwrap();
    }

    #[test]
    fn part_root_survives_while_another_task_stages_there() {
        let dest = temp_dir("shared");
        let mine = "f".repeat(40);
        let other = "0".repeat(40);
        let row = direct_row(&dest, &mine);
        std::fs::create_dir_all(&row.work_dir).unwrap();
        std::fs::create_dir_all(part_root(&dest).join(&other)).unwrap();
        remove_part_dir(&row).unwrap();
        assert!(!Path::new(&row.work_dir).exists());
        assert!(part_root(&dest).join(&other).exists());
        std::fs::remove_dir_all(dest).unwrap();
    }
}
