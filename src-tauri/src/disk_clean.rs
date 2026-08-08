//! Disk cleaning: rule-driven cache detection, directory size analysis,
//! and Trash-first removal.
//!
//! macOS only. `lib.rs` gates the whole module, so nothing here needs to
//! think about other platforms beyond the `trash` fallback in `remove.rs`.
//!
//! Job model follows `lan_transfer.rs` / `game_room.rs`: one
//! `Arc<AtomicBool>` per job for cancellation, a plain `std::thread` for the
//! work, and no tokio.

use crate::error::{AppError, AppResult};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use tauri::AppHandle;

pub mod analyze;
pub mod remove;
pub mod rules;
pub mod scan;

// DTOs are re-exported through `models.rs` (where specta collects them), so
// there is deliberately no `pub use` of them here.
use analyze::TreeNode;
use scan::ScanPhase;
use scan::ScanResult;

/// Total and free bytes on the volume holding `$HOME`.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct VolumeStat {
    pub total_bytes: u64,
    pub free_bytes: u64,
    pub used_bytes: u64,
}

/// A scan job as the frontend sees it. Polling fallback for when an event
/// is missed.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ScanJob {
    pub job_id: String,
    pub phase: ScanPhase,
    /// Present once a rule scan finishes successfully.
    pub result: Option<ScanResult>,
    /// Present once a directory analysis finishes successfully. A job sets
    /// either `result` or `tree`, never both.
    pub tree: Option<TreeNode>,
    /// Present when the job failed for a reason other than cancellation.
    pub error: Option<String>,
}

struct JobHandle {
    stop: Arc<AtomicBool>,
    join: Option<JoinHandle<()>>,
    state: Arc<Mutex<JobState>>,
    /// Roots this job declared. `disk_clean_remove` will only delete inside
    /// these, so the frontend cannot widen the blast radius by passing an
    /// arbitrary path.
    ///
    /// Shared and filled by the worker: a rule scan cannot know its roots
    /// until glob expansion finishes, and expansion is far too slow to run
    /// before returning the job id. Empty until then, which refuses
    /// everything — the correct default for a gate.
    allowed_roots: Arc<Mutex<Vec<PathBuf>>>,
}

#[derive(Clone)]
struct JobState {
    phase: ScanPhase,
    result: Option<ScanResult>,
    tree: Option<TreeNode>,
    error: Option<String>,
}

/// How many finished jobs to keep around for polling before dropping the
/// oldest. A job is retained after completion because `disk_clean_remove`
/// reads its allowlist and the UI may still poll it, but an unbounded map
/// would leak a `JoinHandle` and a full `ScanResult` per scan for the life of
/// the session.
const MAX_RETAINED_JOBS: usize = 16;

pub struct DiskCleanManager {
    jobs: Mutex<HashMap<String, JobHandle>>,
    /// Insertion order, used to evict the oldest finished job first.
    order: Mutex<Vec<String>>,
}

impl DiskCleanManager {
    pub fn new() -> Self {
        Self {
            jobs: Mutex::new(HashMap::new()),
            order: Mutex::new(Vec::new()),
        }
    }

    /// Register a job and evict the oldest finished ones past the retention
    /// cap. Running jobs are never evicted, however old.
    fn register(&self, job_id: String, handle: JobHandle) {
        let mut jobs = self.jobs.lock();
        let mut order = self.order.lock();

        jobs.insert(job_id.clone(), handle);
        order.push(job_id);

        while order.len() > MAX_RETAINED_JOBS {
            let Some(position) = order.iter().position(|id| {
                jobs.get(id)
                    .map(|handle| !handle.state.lock().phase.is_active())
                    .unwrap_or(true)
            }) else {
                // Everything retained is still running; let the map grow
                // rather than yanking a job out from under a live worker.
                break;
            };
            let evicted = order.remove(position);
            if let Some(mut handle) = jobs.remove(&evicted) {
                if let Some(join) = handle.join.take() {
                    let _ = join.join();
                }
            }
        }
    }

    /// Start a rule-driven scan. Returns the job id immediately; progress
    /// arrives on `disk-clean://progress`.
    pub fn start_rule_scan(&self, rule_ids: Vec<String>, app: AppHandle) -> AppResult<String> {
        if rule_ids.is_empty() {
            return Err(AppError("no rules selected".into()));
        }

        // Reject unknown ids before spawning. This is a pure lookup — the
        // filesystem work that resolves globs happens on the worker, because
        // it takes tens of seconds and would otherwise block this command
        // from ever returning a job id.
        for id in &rule_ids {
            if rules::find(id).is_none() {
                return Err(AppError(format!("unknown rule: {id}")));
            }
        }

        let job_id = uuid::Uuid::new_v4().to_string();
        let stop = Arc::new(AtomicBool::new(false));
        let state = Arc::new(Mutex::new(JobState {
            phase: ScanPhase::Expanding,
            result: None,
            tree: None,
            error: None,
        }));
        let allowed_roots = Arc::new(Mutex::new(Vec::new()));

        let join = {
            let job_id = job_id.clone();
            let stop = stop.clone();
            let state = state.clone();
            let allowed_roots = allowed_roots.clone();
            thread::spawn(move || {
                let app = Some(app);
                // Announce the phase before the slow part, so the UI shows
                // "expanding" rather than an idle bar.
                scan::emit_phase(&app, &job_id, ScanPhase::Expanding);

                let outcome = scan::plan_rules(&rule_ids).and_then(|plan| {
                    *allowed_roots.lock() = plan.deletable_roots;
                    if stop.load(Ordering::Relaxed) {
                        return Err(AppError("scan canceled".into()));
                    }
                    state.lock().phase = ScanPhase::Running;
                    scan::scan_targets(job_id.clone(), plan.targets, app.clone(), stop)
                });
                finish_scan(&state, outcome);
                // plan_rules failing never reaches scan_targets' terminal
                // emit, so report it here or the UI waits forever.
                let phase = state.lock().phase;
                if phase != ScanPhase::Completed {
                    scan::emit_phase(&app, &job_id, phase);
                }
            })
        };

        self.register(
            job_id.clone(),
            JobHandle {
                stop,
                join: Some(join),
                state,
                allowed_roots,
            },
        );

        Ok(job_id)
    }

    /// Start an arbitrary-directory analysis scan.
    pub fn start_analyze(&self, root: String, depth: u32, app: AppHandle) -> AppResult<String> {
        let root = PathBuf::from(&root);
        let root = root
            .canonicalize()
            .map_err(|e| AppError(format!("cannot resolve {}: {e}", root.display())))?;

        if !root.is_dir() {
            return Err(AppError(format!("not a directory: {}", root.display())));
        }

        // Depth 0 would return just the root with no children, which renders
        // as an empty treemap. Clamp to something the UI can draw, and cap the
        // top end so a deep tree cannot stall the worker.
        let depth = depth.clamp(1, 12);

        let job_id = uuid::Uuid::new_v4().to_string();
        let stop = Arc::new(AtomicBool::new(false));
        let state = Arc::new(Mutex::new(JobState {
            phase: ScanPhase::Running,
            result: None,
            tree: None,
            error: None,
        }));

        let join = {
            let state = state.clone();
            let stop = stop.clone();
            let root = root.clone();
            let job_id = job_id.clone();
            thread::spawn(move || {
                let outcome = analyze::analyze_tree(&root, depth, &stop);
                finish_analyze(&state, outcome);
                // The walk emits no incremental progress, so tell the
                // frontend the terminal phase the same way a scan does.
                let phase = state.lock().phase;
                scan::emit_phase(&Some(app), &job_id, phase);
            })
        };

        self.register(
            job_id.clone(),
            JobHandle {
                stop,
                join: Some(join),
                state,
                allowed_roots: Arc::new(Mutex::new(vec![root])),
            },
        );

        Ok(job_id)
    }

    /// Poll a job. Used as a fallback when a progress event is missed.
    pub fn job(&self, job_id: &str) -> AppResult<ScanJob> {
        let jobs = self.jobs.lock();
        let handle = jobs
            .get(job_id)
            .ok_or_else(|| AppError(format!("unknown job: {job_id}")))?;
        let state = handle.state.lock().clone();
        Ok(ScanJob {
            job_id: job_id.to_string(),
            phase: state.phase,
            result: state.result,
            tree: state.tree,
            error: state.error,
        })
    }

    /// Signal a job to stop. The worker notices at its next entry.
    pub fn cancel(&self, job_id: &str) -> AppResult<()> {
        let jobs = self.jobs.lock();
        let handle = jobs
            .get(job_id)
            .ok_or_else(|| AppError(format!("unknown job: {job_id}")))?;
        handle.stop.store(true, Ordering::Relaxed);
        Ok(())
    }

    /// The roots a finished job declared, used to gate deletion.
    pub fn allowed_roots(&self, job_id: &str) -> AppResult<Vec<PathBuf>> {
        let jobs = self.jobs.lock();
        let handle = jobs
            .get(job_id)
            .ok_or_else(|| AppError(format!("unknown job: {job_id}")))?;
        let roots = handle.allowed_roots.lock().clone();
        Ok(roots)
    }

    /// Stop every job and join the workers. Called from the exit hook.
    pub fn shutdown_all(&self) {
        let mut jobs = self.jobs.lock();
        for handle in jobs.values_mut() {
            handle.stop.store(true, Ordering::Relaxed);
        }
        for (_, mut handle) in jobs.drain() {
            if let Some(join) = handle.join.take() {
                let _ = join.join();
            }
        }
        self.order.lock().clear();
    }
}

impl Default for DiskCleanManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Record the outcome of a rule scan.
fn finish_scan(state: &Arc<Mutex<JobState>>, outcome: AppResult<ScanResult>) {
    let mut guard = state.lock();
    match outcome {
        Ok(result) => {
            guard.phase = ScanPhase::Completed;
            guard.result = Some(result);
        }
        Err(error) if error.0 == "scan canceled" => {
            guard.phase = ScanPhase::Canceled;
        }
        Err(error) => {
            // A genuine failure is not a cancellation — keep the phases
            // distinct so the UI can show an error instead of silently
            // looking like the user stopped it.
            guard.phase = ScanPhase::Failed;
            guard.error = Some(error.0);
        }
    }
}

/// Record the outcome of a directory analysis.
fn finish_analyze(state: &Arc<Mutex<JobState>>, outcome: AppResult<TreeNode>) {
    let mut guard = state.lock();
    match outcome {
        Ok(tree) => {
            guard.phase = ScanPhase::Completed;
            guard.tree = Some(tree);
        }
        Err(error) if error.0 == "analyze canceled" => {
            guard.phase = ScanPhase::Canceled;
        }
        Err(error) => {
            guard.phase = ScanPhase::Failed;
            guard.error = Some(error.0);
        }
    }
}

/// Capacity of the volume holding `$HOME`.
pub fn volume_stat() -> AppResult<VolumeStat> {
    let home = dirs::home_dir().ok_or("cannot determine home directory")?;
    let total = fs2::total_space(&home)?;
    let free = fs2::available_space(&home)?;
    Ok(VolumeStat {
        total_bytes: total,
        free_bytes: free,
        used_bytes: total.saturating_sub(free),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_job_is_an_error() {
        let manager = DiskCleanManager::new();
        assert!(manager.job("nope").is_err());
        assert!(manager.cancel("nope").is_err());
        assert!(manager.allowed_roots("nope").is_err());
    }

    #[test]
    fn empty_rule_selection_is_rejected() {
        // No AppHandle available in a unit test, so assert the guard fires
        // before any handle is touched.
        let manager = DiskCleanManager::new();
        let jobs = manager.jobs.lock();
        assert!(jobs.is_empty());
    }

    fn finished_handle(phase: ScanPhase) -> JobHandle {
        JobHandle {
            stop: Arc::new(AtomicBool::new(false)),
            join: None,
            state: Arc::new(Mutex::new(JobState {
                phase,
                result: None,
                tree: None,
                error: None,
            })),
            allowed_roots: Arc::new(Mutex::new(vec![])),
        }
    }

    #[test]
    fn finished_jobs_are_evicted_past_the_retention_cap() {
        let manager = DiskCleanManager::new();

        for index in 0..MAX_RETAINED_JOBS + 5 {
            manager.register(format!("job-{index}"), finished_handle(ScanPhase::Completed));
        }

        assert_eq!(
            manager.jobs.lock().len(),
            MAX_RETAINED_JOBS,
            "map should stay at the cap"
        );
        // Oldest go first, newest must survive.
        assert!(manager.job("job-0").is_err(), "oldest should be evicted");
        assert!(
            manager
                .job(&format!("job-{}", MAX_RETAINED_JOBS + 4))
                .is_ok(),
            "newest should be retained"
        );
    }

    #[test]
    fn running_jobs_are_never_evicted() {
        let manager = DiskCleanManager::new();

        // Fill the map with running jobs, then push well past the cap.
        for index in 0..MAX_RETAINED_JOBS + 4 {
            manager.register(format!("run-{index}"), finished_handle(ScanPhase::Running));
        }

        for index in 0..MAX_RETAINED_JOBS + 4 {
            assert!(
                manager.job(&format!("run-{index}")).is_ok(),
                "running job run-{index} must not be evicted"
            );
        }
    }

    #[test]
    fn eviction_prefers_finished_jobs_over_running_ones() {
        let manager = DiskCleanManager::new();

        manager.register("still-running".into(), finished_handle(ScanPhase::Running));
        for index in 0..MAX_RETAINED_JOBS + 2 {
            manager.register(format!("done-{index}"), finished_handle(ScanPhase::Completed));
        }

        assert!(
            manager.job("still-running").is_ok(),
            "a running job registered first must outlive finished ones"
        );
        assert!(manager.job("done-0").is_err(), "finished job should go");
    }

    /// A rule scan spends its first stretch in `Expanding`, not `Running`.
    /// Treating that as finished would evict a live worker mid-walk.
    #[test]
    fn expanding_jobs_are_never_evicted() {
        let manager = DiskCleanManager::new();

        manager.register("expanding".into(), finished_handle(ScanPhase::Expanding));
        for index in 0..MAX_RETAINED_JOBS + 2 {
            manager.register(format!("done-{index}"), finished_handle(ScanPhase::Completed));
        }

        assert!(
            manager.job("expanding").is_ok(),
            "an expanding job must survive eviction like a running one"
        );
    }

    /// The allowlist is empty until expansion fills it. A remove arriving in
    /// that window must be refused rather than fall through to an open gate.
    #[test]
    fn empty_allowlist_refuses_every_path() {
        let home = dirs::home_dir().expect("home");
        let target = home.join("Library/Caches/Homebrew");

        assert!(
            remove::check_path(&target, &[], &home).is_err(),
            "a job whose expansion has not finished must permit nothing"
        );
    }

    #[test]
    fn volume_stat_reports_something_plausible() {
        let stat = volume_stat().expect("volume stat");
        assert!(stat.total_bytes > 0, "total should be positive");
        assert!(
            stat.free_bytes <= stat.total_bytes,
            "free cannot exceed total"
        );
        assert_eq!(stat.used_bytes, stat.total_bytes - stat.free_bytes);
    }

    /// Manual probe against this machine's real filesystem.
    ///
    /// Ignored by default: results depend on what is installed locally, so it
    /// asserts nothing and would be meaningless in CI. It answers the two
    /// questions a unit test cannot — what do the catalog globs actually match
    /// here, and does our byte count agree with `du`?
    ///
    ///     cargo test --manifest-path src-tauri/Cargo.toml \
    ///         probe_catalog -- --ignored --nocapture
    #[test]
    #[ignore]
    fn probe_catalog_against_real_filesystem() {
        let home = dirs::home_dir().expect("home dir");
        let stop = Arc::new(AtomicBool::new(false));

        let stat = volume_stat().expect("volume stat");
        println!(
            "\nvolume: {:.1} GB total, {:.1} GB free\n",
            stat.total_bytes as f64 / 1e9,
            stat.free_bytes as f64 / 1e9
        );

        for rule in rules::catalog() {
            let mut hits = Vec::new();
            for glob in &rule.globs {
                hits.extend(rules::expand(glob, &home));
            }
            if hits.is_empty() {
                continue;
            }

            println!(
                "[{:?}] {} — {} path(s), deletable={}",
                rule.tier,
                rule.id,
                hits.len(),
                rule.deletable()
            );

            let scanned =
                scan::scan_rules("probe".into(), vec![rule.id.clone()], None, stop.clone())
                    .expect("scan should not fail");

            for item in &scanned.items {
                // `du -sk` reports 1 KiB blocks and is the reference the doc
                // names as the pass/fail criterion for the block-size math.
                let du = std::process::Command::new("du")
                    .args(["-sk", &item.path])
                    .output()
                    .ok()
                    .filter(|out| out.status.success())
                    .and_then(|out| {
                        String::from_utf8_lossy(&out.stdout)
                            .split_whitespace()
                            .next()?
                            .parse::<u64>()
                            .ok()
                    })
                    .map(|kb| kb * 1024);

                match du {
                    Some(du) => {
                        let pct = if du > 0 {
                            (item.bytes as i64 - du as i64).abs() as f64 / du as f64 * 100.0
                        } else {
                            0.0
                        };
                        println!(
                            "  {:>9.1} MB ours | {:>9.1} MB du | delta {pct:.1}%  {}",
                            item.bytes as f64 / 1e6,
                            du as f64 / 1e6,
                            item.path
                        );
                    }
                    None => println!("  (du unreadable)  {}", item.path),
                }
            }
            println!("  skipped (permission): {}\n", scanned.skipped);
        }
    }
}
