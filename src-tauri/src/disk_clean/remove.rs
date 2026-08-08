//! Deletion with a three-layer path gate.
//!
//! Nothing here trusts the frontend. Every path is re-derived and
//! re-checked in Rust before a single byte is touched:
//!
//!   1. **Symlink refusal** — `symlink_metadata` before anything else, so a
//!      link can never redirect a delete somewhere else.
//!   2. **Hard denial list** — system roots and the top level of the user's
//!      real document folders are never deletable, whatever else says so.
//!   3. **Allowlist** — the path must sit inside a root the scan declared,
//!      or under a directory some catalog rule actually expands to.
//!
//! A path must clear all three. The default is refusal.

use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::{Path, PathBuf};

/// Outcome of one delete request.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RemoveReport {
    pub removed: Vec<RemovedItem>,
    pub failed: Vec<FailedItem>,
    pub freed_bytes: u64,
    /// True when files went to the Trash and can still be put back.
    pub recoverable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RemovedItem {
    pub path: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FailedItem {
    pub path: String,
    pub reason: String,
}

/// Paths that are never deletable, at any tier, by any rule.
///
/// Absolute system roots plus the user's real content directories. The
/// *top level* of `~/Documents` is refused; a build cache nested inside it
/// still passes, because the allowlist is what grants access and this list
/// only blocks the folder itself.
fn hard_denied(home: &Path) -> Vec<PathBuf> {
    let mut denied = vec![
        PathBuf::from("/"),
        PathBuf::from("/System"),
        PathBuf::from("/Library"),
        PathBuf::from("/Applications"),
        PathBuf::from("/Users"),
        PathBuf::from("/bin"),
        PathBuf::from("/sbin"),
        PathBuf::from("/usr"),
        PathBuf::from("/etc"),
        PathBuf::from("/var"),
        PathBuf::from("/private"),
        PathBuf::from("/Volumes"),
        home.to_path_buf(),
    ];

    for name in [
        "Documents",
        "Desktop",
        "Downloads",
        "Pictures",
        "Movies",
        "Music",
        "Library",
        "Applications",
        "Public",
    ] {
        denied.push(home.join(name));
    }

    denied
}

/// Check one path against all three layers. `Ok` means safe to delete.
///
/// `allowed_roots` are the roots the caller declared for this operation —
/// scan targets, or rule expansions. An empty list refuses everything,
/// which is the correct failure mode.
pub fn check_path(target: &Path, allowed_roots: &[PathBuf], home: &Path) -> AppResult<PathBuf> {
    // --- Layer 1: symlinks, before any resolution ---
    // symlink_metadata does not follow the link, so this sees the link
    // itself. Checking here means a link can never be used to redirect a
    // delete outside the allowlist.
    let link_meta = target
        .symlink_metadata()
        .map_err(|e| AppError(format!("cannot stat {}: {e}", target.display())))?;

    if link_meta.file_type().is_symlink() {
        return Err(AppError(format!(
            "refusing to delete symlink: {}",
            target.display()
        )));
    }

    // Resolve only after the symlink check, so `canonicalize` cannot be the
    // thing that walks us somewhere unexpected.
    let resolved = target
        .canonicalize()
        .map_err(|e| AppError(format!("cannot resolve {}: {e}", target.display())))?;

    // --- Layer 2: hard denial list ---
    // Compare against the resolved path so `~/foo/..` cannot spell `/`.
    for denied in hard_denied(home) {
        // Canonicalize the denied entry too; on macOS `/var` is a symlink
        // to `/private/var`, so a raw comparison would miss it.
        let denied_resolved = denied.canonicalize().unwrap_or(denied.clone());
        if resolved == denied_resolved {
            return Err(AppError(format!(
                "refusing to delete protected path: {}",
                resolved.display()
            )));
        }
    }

    // --- Layer 3: allowlist ---
    // starts_with is component-wise, so `/foo/bar-evil` does not match the
    // root `/foo/bar`.
    let permitted = allowed_roots.iter().any(|root| {
        let root_resolved = root.canonicalize().unwrap_or_else(|_| root.clone());
        resolved.starts_with(&root_resolved)
    });

    if !permitted {
        return Err(AppError(format!(
            "path outside allowed roots: {}",
            resolved.display()
        )));
    }

    Ok(resolved)
}

/// Total real disk size of a path, for reporting freed bytes.
fn path_size(path: &Path) -> u64 {
    #[cfg(unix)]
    use std::os::unix::fs::MetadataExt;

    let mut total = 0u64;
    for entry in walkdir::WalkDir::new(path).follow_links(false) {
        let Ok(entry) = entry else { continue };
        let Ok(meta) = entry.path().symlink_metadata() else {
            continue;
        };
        #[cfg(unix)]
        {
            total += meta.blocks() * 512;
        }
        #[cfg(not(unix))]
        {
            total += meta.len();
        }
    }
    total
}

/// Delete the given paths. Every one is gated before it is touched.
///
/// `permanent = false` moves to the Trash (recoverable). `permanent = true`
/// deletes outright — offered because moving tens of gigabytes to the Trash
/// is slow and doesn't free the space until it's emptied.
///
/// One rejected path does not stop the batch; it lands in `failed`.
pub fn remove_paths(
    paths: Vec<String>,
    permanent: bool,
    allowed_roots: &[PathBuf],
) -> AppResult<RemoveReport> {
    let home = dirs::home_dir().ok_or("cannot determine home directory")?;
    let mut removed = Vec::new();
    let mut failed = Vec::new();
    let mut freed = 0u64;

    for raw in paths {
        let target = PathBuf::from(&raw);

        let checked = match check_path(&target, allowed_roots, &home) {
            Ok(path) => path,
            Err(error) => {
                failed.push(FailedItem {
                    path: raw,
                    reason: error.0,
                });
                continue;
            }
        };

        // Measure before deleting; afterwards there is nothing to stat.
        let bytes = path_size(&checked);

        let outcome = if permanent {
            if checked.is_dir() {
                std::fs::remove_dir_all(&checked).map_err(|e| e.to_string())
            } else {
                std::fs::remove_file(&checked).map_err(|e| e.to_string())
            }
        } else {
            trash_path(&checked)
        };

        match outcome {
            Ok(()) => {
                freed += bytes;
                removed.push(RemovedItem {
                    path: checked.to_string_lossy().to_string(),
                    bytes,
                });
            }
            Err(reason) => failed.push(FailedItem {
                path: checked.to_string_lossy().to_string(),
                reason,
            }),
        }
    }

    Ok(RemoveReport {
        removed,
        failed,
        freed_bytes: freed,
        recoverable: !permanent,
    })
}

#[cfg(target_os = "macos")]
fn trash_path(path: &Path) -> Result<(), String> {
    trash::delete(path).map_err(|e| e.to_string())
}

/// Non-macOS builds have no Trash integration; refuse rather than silently
/// escalating to a permanent delete.
#[cfg(not(target_os = "macos"))]
fn trash_path(_path: &Path) -> Result<(), String> {
    Err("trash is only supported on macOS".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_root(tag: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("mftp-rm-{tag}-{}", std::process::id()));
        fs::create_dir_all(&root).expect("create temp root");
        root.canonicalize().expect("canonicalize temp root")
    }

    /// End-to-end Trash round-trip against the real Finder Trash.
    ///
    /// Ignored by default: it actually moves a directory to `~/.Trash`, which
    /// is a side effect no CI run should have. Run it before trusting the
    /// delete button, since `trash::delete` is the one path unit tests
    /// otherwise stub out entirely:
    ///
    ///     cargo test --manifest-path src-tauri/Cargo.toml \
    ///         trash_roundtrip -- --ignored --nocapture
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore]
    fn trash_roundtrip_moves_and_reports_recoverable() {
        let root = temp_root("trash-roundtrip");
        let cache = root.join("node_modules/.cache");
        fs::create_dir_all(&cache).expect("create cache");
        fs::write(cache.join("blob.bin"), vec![7u8; 512 * 1024]).expect("write blob");

        // A link pointing outside must be refused rather than followed.
        let escape = root.join("node_modules/.vite");
        std::os::unix::fs::symlink("/", &escape).expect("create symlink");

        let report = remove_paths(
            vec![
                cache.to_string_lossy().into(),
                escape.to_string_lossy().into(),
            ],
            false,
            std::slice::from_ref(&root),
        )
        .expect("remove should report");

        assert_eq!(report.removed.len(), 1, "only the cache should be removed");
        assert_eq!(report.failed.len(), 1, "the symlink should be refused");
        assert!(
            report.failed[0].reason.contains("symlink"),
            "refusal should name the symlink: {}",
            report.failed[0].reason
        );
        assert!(report.recoverable, "trash delete must report recoverable");
        assert!(!cache.exists(), "cache should be gone from its old path");
        assert!(
            escape.symlink_metadata().is_ok(),
            "the refused symlink must still be there"
        );
        assert!(
            report.freed_bytes >= 512 * 1024,
            "freed bytes should cover the blob, got {}",
            report.freed_bytes
        );

        println!(
            "moved {} to Trash ({} bytes) — verify 'Put Back' in Finder",
            report.removed[0].path, report.freed_bytes
        );

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn refuses_path_outside_allowed_roots() {
        let root = temp_root("outside");
        let allowed = root.join("allowed");
        let outside = root.join("outside");
        fs::create_dir_all(&allowed).unwrap();
        fs::create_dir_all(&outside).unwrap();

        let home = dirs::home_dir().unwrap();
        let result = check_path(&outside, std::slice::from_ref(&allowed), &home);

        assert!(result.is_err(), "path outside roots must be refused");
        assert!(result.unwrap_err().0.contains("outside allowed roots"));

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn refuses_traversal_escape() {
        let root = temp_root("escape");
        let allowed = root.join("allowed");
        let sibling = root.join("sibling");
        fs::create_dir_all(&allowed).unwrap();
        fs::create_dir_all(&sibling).unwrap();

        // `allowed/../sibling` resolves outside the allowlist.
        let escape = allowed.join("..").join("sibling");
        let home = dirs::home_dir().unwrap();
        let result = check_path(&escape, std::slice::from_ref(&allowed), &home);

        assert!(result.is_err(), "traversal escape must be refused");

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn refuses_sibling_prefix_collision() {
        // `/tmp/x/allowed-evil` must not pass because it shares a string
        // prefix with the root `/tmp/x/allowed`.
        let root = temp_root("prefix");
        let allowed = root.join("allowed");
        let evil = root.join("allowed-evil");
        fs::create_dir_all(&allowed).unwrap();
        fs::create_dir_all(&evil).unwrap();

        let home = dirs::home_dir().unwrap();
        let result = check_path(&evil, std::slice::from_ref(&allowed), &home);

        assert!(
            result.is_err(),
            "sibling sharing a name prefix must be refused"
        );

        fs::remove_dir_all(&root).ok();
    }

    #[cfg(unix)]
    #[test]
    fn refuses_symlink_even_inside_allowed_root() {
        let root = temp_root("symlink");
        let allowed = root.join("allowed");
        fs::create_dir_all(&allowed).unwrap();

        // Link sits inside the allowlist but points at `/`. The symlink
        // check must fire before the allowlist ever grants it.
        let link = allowed.join("link-to-root");
        std::os::unix::fs::symlink("/", &link).expect("create symlink");

        let home = dirs::home_dir().unwrap();
        let result = check_path(&link, std::slice::from_ref(&allowed), &home);

        assert!(result.is_err(), "symlink must be refused");
        assert!(
            result.unwrap_err().0.contains("symlink"),
            "error should name the symlink as the reason"
        );

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn refuses_hard_denied_roots_even_if_allowlisted() {
        let home = dirs::home_dir().unwrap();

        // Deliberately pass the widest possible allowlist. The denial list
        // must still win.
        let wide = vec![PathBuf::from("/")];

        for path in [
            PathBuf::from("/"),
            PathBuf::from("/System"),
            PathBuf::from("/Applications"),
            PathBuf::from("/Users"),
            home.clone(),
            home.join("Documents"),
            home.join("Desktop"),
            home.join("Downloads"),
        ] {
            if !path.exists() {
                continue;
            }
            let result = check_path(&path, &wide, &home);
            assert!(
                result.is_err(),
                "{} must be refused even with a permissive allowlist",
                path.display()
            );
        }
    }

    #[test]
    fn empty_allowlist_refuses_everything() {
        let root = temp_root("empty");
        let target = root.join("target");
        fs::create_dir_all(&target).unwrap();

        let home = dirs::home_dir().unwrap();
        let result = check_path(&target, &[], &home);

        assert!(result.is_err(), "empty allowlist must refuse");

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn accepts_legitimate_nested_target() {
        let root = temp_root("accept");
        let cache = root.join("project/node_modules/.cache");
        fs::create_dir_all(&cache).unwrap();

        let home = dirs::home_dir().unwrap();
        let result = check_path(&cache, std::slice::from_ref(&root), &home);

        assert!(
            result.is_ok(),
            "nested cache inside an allowed root should pass: {result:?}"
        );

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn rejected_path_does_not_stop_the_batch() {
        let root = temp_root("batch");
        let good = root.join("good");
        fs::create_dir_all(&good).unwrap();
        fs::write(good.join("f.txt"), b"data").unwrap();

        let report = remove_paths(
            vec![
                "/System".to_string(),         // hard denied
                good.to_string_lossy().into(), // legitimate
            ],
            true,
            std::slice::from_ref(&root),
        )
        .expect("remove should return a report");

        assert_eq!(report.failed.len(), 1, "denied path should be reported");
        assert_eq!(report.removed.len(), 1, "good path should still be removed");
        assert!(!good.exists(), "good path should be gone");
        assert!(!report.recoverable, "permanent delete is not recoverable");

        fs::remove_dir_all(&root).ok();
    }
}
