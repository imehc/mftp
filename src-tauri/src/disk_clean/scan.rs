//! Directory traversal with real disk size, inode dedup, and throttled progress.
//!
//! Uses `metadata.blocks() * 512` to match `du -sh` rather than `len()`,
//! since APFS sparse files, clones, and transparent compression make the two
//! diverge wildly. Tracks `(dev, ino)` to avoid double-counting hardlinks.

use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;

#[cfg(unix)]
use std::os::unix::fs::MetadataExt;

/// Live scan progress, emitted at most once per 120ms.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub job_id: String,
    pub scanned_files: u64,
    pub scanned_dirs: u64,
    pub total_bytes: u64,
    pub skipped: u64,
    pub phase: ScanPhase,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum ScanPhase {
    /// Resolving rule globs against the filesystem. Separate from `Running`
    /// because it can take tens of seconds on a large `$HOME` and produces no
    /// counters — without its own phase the UI cannot tell "working" from
    /// "hung".
    Expanding,
    Running,
    Completed,
    Canceled,
    /// Terminated by an error rather than by the user.
    Failed,
}

impl ScanPhase {
    /// True while a worker is still doing something. Used to keep live jobs
    /// out of the retention eviction.
    pub fn is_active(self) -> bool {
        matches!(self, ScanPhase::Expanding | ScanPhase::Running)
    }
}

/// What a set of rules resolves to on this machine.
pub struct ScanPlan {
    /// Every path to walk, paired with the rule that produced it.
    pub targets: Vec<(PathBuf, Option<String>)>,
    /// The subset deletion is allowed to touch. `manual` rules are scannable
    /// but contribute nothing here, so the remove gate rejects their paths.
    pub deletable_roots: Vec<PathBuf>,
}

/// Resolve rule globs into concrete paths.
///
/// Touches the filesystem and takes tens of seconds on a large `$HOME`, so
/// this must run on a worker thread — never on the IPC thread, or the
/// `disk_clean_scan` command blocks for its whole duration.
pub fn plan_rules(rule_ids: &[String]) -> AppResult<ScanPlan> {
    use super::rules;

    let home = dirs::home_dir().ok_or("cannot determine home directory")?;
    let mut targets = Vec::new();
    let mut deletable_roots = Vec::new();

    for id in rule_ids {
        let rule = rules::find(id).ok_or_else(|| AppError(format!("unknown rule: {id}")))?;
        for glob in &rule.globs {
            for path in rules::expand(glob, &home) {
                if rule.deletable() {
                    deletable_roots.push(path.clone());
                }
                targets.push((path, Some(id.clone())));
            }
        }
    }

    Ok(ScanPlan {
        targets,
        deletable_roots,
    })
}

/// Final scan results.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub job_id: String,
    pub items: Vec<ScannedItem>,
    pub total_bytes: u64,
    pub scanned_files: u64,
    pub scanned_dirs: u64,
    pub skipped: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ScannedItem {
    pub path: String,
    pub bytes: u64,
    pub rule_id: Option<String>,
}

/// Expand the given rules and scan whatever they resolve to, in one call.
///
/// Only the real-filesystem probe uses this. Production splits the two steps
/// so the manager can report the expansion phase separately and capture the
/// deletable allowlist, so this is gated to tests rather than left as dead
/// code in the shipped binary.
#[cfg(test)]
pub fn scan_rules(
    job_id: String,
    rule_ids: Vec<String>,
    app: Option<AppHandle>,
    stop: Arc<AtomicBool>,
) -> AppResult<ScanResult> {
    let plan = plan_rules(&rule_ids)?;
    scan_targets(job_id, plan.targets, app, stop)
}

pub fn scan_targets(
    job_id: String,
    targets: Vec<(PathBuf, Option<String>)>,
    app: Option<AppHandle>,
    stop: Arc<AtomicBool>,
) -> AppResult<ScanResult> {
    let mut items = Vec::new();
    let mut seen = HashSet::new();
    let files = Arc::new(AtomicU64::new(0));
    let dirs = Arc::new(AtomicU64::new(0));
    let total = Arc::new(AtomicU64::new(0));
    let skipped = Arc::new(AtomicU64::new(0));
    let mut last_emit = Instant::now();

    for (target, rule_id) in targets {
        if stop.load(Ordering::Relaxed) {
            emit_progress(
                &app,
                &job_id,
                &files,
                &dirs,
                &total,
                &skipped,
                ScanPhase::Canceled,
            );
            return Err(AppError("scan canceled".into()));
        }

        let mut target_bytes = 0u64;

        for entry in WalkDir::new(&target).follow_links(false) {
            if stop.load(Ordering::Relaxed) {
                emit_progress(
                    &app,
                    &job_id,
                    &files,
                    &dirs,
                    &total,
                    &skipped,
                    ScanPhase::Canceled,
                );
                return Err(AppError("scan canceled".into()));
            }

            let entry = match entry {
                Ok(e) => e,
                Err(_) => {
                    skipped.fetch_add(1, Ordering::Relaxed);
                    continue;
                }
            };

            // symlink_metadata: never follow links so a link doesn't pull
            // the scan outside the intended root.
            let meta = match entry.path().symlink_metadata() {
                Ok(m) => m,
                Err(_) => {
                    skipped.fetch_add(1, Ordering::Relaxed);
                    continue;
                }
            };

            if meta.is_dir() {
                dirs.fetch_add(1, Ordering::Relaxed);
            } else {
                files.fetch_add(1, Ordering::Relaxed);
            }

            let real_bytes = real_disk_size(&meta);

            // Hardlink dedup: only count a file the first time we see its
            // (dev, ino). APFS clone files share extents but have distinct
            // inodes, so they count separately — that's the correct behavior
            // since deleting one clone doesn't free the space until all are
            // gone.
            #[cfg(unix)]
            {
                let key = (meta.dev(), meta.ino());
                if !seen.insert(key) {
                    continue;
                }
            }

            target_bytes += real_bytes;
            total.fetch_add(real_bytes, Ordering::Relaxed);

            // Throttle events to 120ms so the IPC bridge doesn't choke on
            // deep trees.
            if last_emit.elapsed() >= Duration::from_millis(120) {
                emit_progress(
                    &app,
                    &job_id,
                    &files,
                    &dirs,
                    &total,
                    &skipped,
                    ScanPhase::Running,
                );
                last_emit = Instant::now();
            }
        }

        items.push(ScannedItem {
            path: target.to_string_lossy().to_string(),
            bytes: target_bytes,
            rule_id,
        });
    }

    emit_progress(
        &app,
        &job_id,
        &files,
        &dirs,
        &total,
        &skipped,
        ScanPhase::Completed,
    );

    Ok(ScanResult {
        job_id,
        items,
        total_bytes: total.load(Ordering::Relaxed),
        scanned_files: files.load(Ordering::Relaxed),
        scanned_dirs: dirs.load(Ordering::Relaxed),
        skipped: skipped.load(Ordering::Relaxed),
    })
}

/// Real on-disk size: what `du` counts. Sparse files, APFS clones, and
/// transparent compression make `len()` diverge wildly from blocks.
#[cfg(unix)]
fn real_disk_size(meta: &std::fs::Metadata) -> u64 {
    meta.blocks() * 512
}

#[cfg(not(unix))]
fn real_disk_size(meta: &std::fs::Metadata) -> u64 {
    meta.len()
}

fn emit_progress(
    app: &Option<AppHandle>,
    job_id: &str,
    files: &Arc<AtomicU64>,
    dirs: &Arc<AtomicU64>,
    total: &Arc<AtomicU64>,
    skipped: &Arc<AtomicU64>,
    phase: ScanPhase,
) {
    let Some(handle) = app else { return };
    let progress = ScanProgress {
        job_id: job_id.to_string(),
        scanned_files: files.load(Ordering::Relaxed),
        scanned_dirs: dirs.load(Ordering::Relaxed),
        total_bytes: total.load(Ordering::Relaxed),
        skipped: skipped.load(Ordering::Relaxed),
        phase,
    };
    let _ = handle.emit("disk-clean://progress", progress);
}

/// Emit a terminal phase with no counters. The analyze walk builds a tree in
/// one pass and has no incremental totals to report, but the frontend still
/// needs to hear that the job ended.
pub fn emit_phase(app: &Option<AppHandle>, job_id: &str, phase: ScanPhase) {
    let Some(handle) = app else { return };
    let progress = ScanProgress {
        job_id: job_id.to_string(),
        scanned_files: 0,
        scanned_dirs: 0,
        total_bytes: 0,
        skipped: 0,
        phase,
    };
    let _ = handle.emit("disk-clean://progress", progress);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn hardlinks_are_not_double_counted() {
        let root = std::env::temp_dir().join(format!("mftp-scan-hl-{}", std::process::id()));
        fs::create_dir_all(&root).expect("create test dir");

        let orig = root.join("original.txt");
        fs::write(&orig, b"content").expect("write original");

        #[cfg(unix)]
        {
            let link = root.join("hardlink.txt");
            fs::hard_link(&orig, &link).expect("hard link");

            let result = scan_targets(
                "test-hl".into(),
                vec![(root.clone(), None)],
                None,
                Arc::new(AtomicBool::new(false)),
            )
            .expect("scan");

            // Two file entries seen, but blocks counted only once.
            assert_eq!(result.scanned_files, 2, "expected 2 files walked");

            // Real size is nonzero from the original, but the hardlink adds
            // no additional bytes.
            let orig_meta = fs::metadata(&orig).unwrap();
            let expected = orig_meta.blocks() * 512;
            assert_eq!(
                result.total_bytes, expected,
                "hardlink should not add bytes"
            );
        }

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn permission_denied_does_not_abort_scan() {
        let root = std::env::temp_dir().join(format!("mftp-scan-perm-{}", std::process::id()));
        fs::create_dir_all(&root).expect("create test dir");

        let accessible = root.join("accessible");
        fs::create_dir_all(&accessible).expect("create accessible");
        fs::write(accessible.join("file.txt"), b"ok").expect("write file");

        // Deliberately broken path that returns an error.
        let broken = root.join("nonexistent_subdir/file.txt");
        let _ = fs::metadata(&broken);

        let result = scan_targets(
            "test-perm".into(),
            vec![(root.clone(), None)],
            None,
            Arc::new(AtomicBool::new(false)),
        );

        assert!(result.is_ok(), "scan should complete despite errors");
        let result = result.unwrap();
        assert!(result.total_bytes > 0, "accessible file should be counted");

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn cancel_stops_scan_early() {
        let root = std::env::temp_dir().join(format!("mftp-scan-cancel-{}", std::process::id()));
        fs::create_dir_all(&root).expect("create test dir");

        for i in 0..100 {
            fs::write(root.join(format!("file{i}.txt")), b"data").ok();
        }

        // Set the flag up front rather than racing a timer against the walk:
        // 100 small files can finish in well under any sleep we'd pick, which
        // made the timer version pass or fail depending on machine load.
        let stop = Arc::new(AtomicBool::new(true));

        let result = scan_targets("test-cancel".into(), vec![(root.clone(), None)], None, stop);

        assert!(result.is_err(), "canceled scan should error");
        assert_eq!(result.unwrap_err().0, "scan canceled");

        fs::remove_dir_all(&root).ok();
    }
}
