//! Tree-map analysis for arbitrary directories.
//!
//! Walk a user-picked directory and produce a nested `TreeNode` the
//! frontend can render as a squarified treemap. One level per depth
//! increment; the children of each node are the files and dirs directly
//! inside it, sorted by size descending.

use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashSet;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

#[cfg(unix)]
use std::os::unix::fs::MetadataExt;

/// A recursive directory tree node.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TreeNode {
    pub name: String,
    pub path: String,
    pub bytes: u64,
    pub is_dir: bool,
    pub children: Vec<TreeNode>,
}

/// Walk `root` up to `max_depth` and return a tree. Depth 0 is the root
/// itself; the frontend sets the cap so a deep tree does not drown the
/// worker thread.
///
/// `stop` is checked at every directory boundary, so a cancel from the UI
/// takes effect within one `read_dir` instead of after the whole walk.
pub fn analyze_tree(root: &Path, max_depth: u32, stop: &AtomicBool) -> AppResult<TreeNode> {
    if stop.load(Ordering::Relaxed) {
        return Err(AppError("analyze canceled".into()));
    }

    let name = file_name(root);
    let is_dir = root.is_dir();
    let mut children = Vec::new();
    // One set for the whole walk. Scoping it per directory would make the
    // dedup a no-op, since two entries in the same directory can only share
    // an inode if one is a hardlink to the other.
    let mut seen = HashSet::new();

    if is_dir && max_depth > 0 {
        children = collect_children(root, max_depth - 1, stop, &mut seen)?;
        // Sort by size descending so the rest of the pipeline (treemap,
        // table) gets the largest items first for free.
        children.sort_by_key(|node| std::cmp::Reverse(node.bytes));
    }

    let bytes = children.iter().map(|c| c.bytes).sum::<u64>() + file_size(root).unwrap_or(0);

    Ok(TreeNode {
        name,
        path: root.to_string_lossy().to_string(),
        bytes,
        is_dir,
        children,
    })
}

fn collect_children(
    dir: &Path,
    remaining_depth: u32,
    stop: &AtomicBool,
    seen: &mut HashSet<(u64, u64)>,
) -> AppResult<Vec<TreeNode>> {
    if stop.load(Ordering::Relaxed) {
        return Err(AppError("analyze canceled".into()));
    }

    // An unreadable directory is normal (permissions), not fatal — report it
    // as empty and keep walking the rest of the tree.
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Ok(vec![]);
    };

    let mut children = Vec::new();

    for entry in entries.flatten() {
        let meta = match entry.path().symlink_metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };

        // Inode dedup, same as scan.rs: count a hardlinked file once no
        // matter how many directories in this tree point at it.
        #[cfg(unix)]
        {
            let key = (meta.dev(), meta.ino());
            if !seen.insert(key) {
                continue;
            }
        }
        #[cfg(not(unix))]
        {
            // Without inodes the best we can do is skip symlinks.
            if meta.file_type().is_symlink() {
                continue;
            }
        }

        let path = entry.path();
        let name = file_name(&path);

        let (bytes, is_dir, sub_children) = if meta.is_dir() && remaining_depth > 0 {
            let subs = collect_children(&path, remaining_depth - 1, stop, seen)?;
            let self_size = file_size(&path).unwrap_or(0);
            let total = subs.iter().map(|c| c.bytes).sum::<u64>() + self_size;
            (total, true, subs)
        } else if meta.is_dir() {
            // Depth cap reached — report dir as a leaf with its content
            // aggregate, but don't recurse further.
            let dir_size = dir_block_total(&path, seen);
            (dir_size, true, vec![])
        } else {
            (file_size(&path).unwrap_or(0), false, vec![])
        };

        children.push(TreeNode {
            name,
            path: path.to_string_lossy().to_string(),
            bytes,
            is_dir,
            children: sub_children,
        });
    }

    children.sort_by_key(|node| std::cmp::Reverse(node.bytes));
    Ok(children)
}

/// Own-file size for non-directory nodes, or block count of the directory
/// entry itself (not its contents).
fn file_size(path: &Path) -> Option<u64> {
    let meta = path.symlink_metadata().ok()?;
    #[cfg(unix)]
    {
        Some(meta.blocks() * 512)
    }
    #[cfg(not(unix))]
    {
        Some(meta.len())
    }
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string())
}

/// Walk a directory tree and sum up all block-based sizes (including
/// contents). Used when the depth cap makes a dir a leaf.
///
/// Shares the caller's `seen` set so a hardlink already counted higher up the
/// tree is not counted again here.
fn dir_block_total(dir: &Path, seen: &mut HashSet<(u64, u64)>) -> u64 {
    let mut total = 0u64;
    for entry in walkdir::WalkDir::new(dir).follow_links(false) {
        let Ok(entry) = entry else { continue };
        let Ok(meta) = entry.path().symlink_metadata() else {
            continue;
        };
        #[cfg(unix)]
        {
            if !seen.insert((meta.dev(), meta.ino())) {
                continue;
            }
            total += meta.blocks() * 512;
        }
        #[cfg(not(unix))]
        {
            let _ = &seen;
            total += meta.len();
        }
    }
    total
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_root(tag: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("mftp-an-{tag}-{}", std::process::id()));
        fs::remove_dir_all(&root).ok();
        fs::create_dir_all(&root).expect("create temp root");
        root
    }

    /// The dedup set used to be scoped per directory, which made it useless:
    /// two entries in one directory only collide when one is a hardlink to the
    /// other, so cross-directory links were counted twice.
    #[cfg(unix)]
    #[test]
    fn hardlinks_across_directories_count_once() {
        let root = temp_root("hardlink");
        let a = root.join("a");
        let b = root.join("b");
        fs::create_dir_all(&a).unwrap();
        fs::create_dir_all(&b).unwrap();

        let original = a.join("payload.bin");
        fs::write(&original, vec![0u8; 64 * 1024]).unwrap();
        fs::hard_link(&original, b.join("same-payload.bin")).unwrap();

        let stop = AtomicBool::new(false);
        let tree = analyze_tree(&root, 4, &stop).expect("analyze");

        let payload = fs::metadata(&original).unwrap().blocks() * 512;
        let dir_a = tree.children.iter().find(|c| c.name == "a").unwrap();
        let dir_b = tree.children.iter().find(|c| c.name == "b").unwrap();

        // Whichever directory is visited first owns the bytes; the other must
        // not restate them.
        assert!(
            dir_a.bytes >= payload || dir_b.bytes >= payload,
            "one directory should carry the payload"
        );
        assert!(
            dir_a.bytes < payload || dir_b.bytes < payload,
            "the hardlink must not be counted a second time: a={}, b={}",
            dir_a.bytes,
            dir_b.bytes
        );

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn children_are_sorted_largest_first() {
        let root = temp_root("sort");
        fs::write(root.join("small.bin"), vec![0u8; 1024]).unwrap();
        fs::write(root.join("large.bin"), vec![0u8; 256 * 1024]).unwrap();

        let stop = AtomicBool::new(false);
        let tree = analyze_tree(&root, 2, &stop).expect("analyze");

        assert_eq!(tree.children.first().unwrap().name, "large.bin");

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn cancel_is_reported_not_swallowed() {
        let root = temp_root("cancel");
        fs::create_dir_all(root.join("child")).unwrap();

        let stop = AtomicBool::new(true);
        let result = analyze_tree(&root, 3, &stop);

        assert!(result.is_err(), "canceled analyze should error");
        assert_eq!(result.unwrap_err().0, "analyze canceled");

        fs::remove_dir_all(&root).ok();
    }
}
