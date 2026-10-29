//! Sync orchestration: job slot management, status/sync plan, and the
//! annotation job admission. Downloading/importing and annotation packs live
//! in the `net`, `ingest` and `annotations` submodules.
//!
//! All heavy work runs on dedicated threads (never the async runtime).
//! Progress flows through an injected callback so tests can observe it
//! without an app handle.

use std::fs;
#[cfg(any(desktop, test))]
use std::path::Path;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use parking_lot::Mutex;

use super::catalog::Catalog;
use super::db::PoetryDb;
use super::model::{
    PoetryCollectionStatus, PoetryContentIndexStatus, PoetrySourceStatus, PoetrySyncPlan,
    PoetrySyncProgress,
};
use crate::core::operations::Operations;
use crate::error::{AppError, AppResult, CustomErrorCode};

mod annotations;
mod github;
mod ingest;
mod net;

use annotations::run_annotations_install;
use github::fetch_source_sha;
use net::run_network_sync;

#[cfg(any(desktop, test))]
use ingest::run_local_import;

/// Event channel shared with the frontend (`src/lib/events.ts`).
pub const SYNC_PROGRESS_EVENT: &str = "library://sync-progress";

type ProgressFn<'a> = dyn Fn(PoetrySyncProgress) + Send + Sync + 'a;

pub struct PoetryLibrary {
    root: PathBuf,
    operations: Arc<Operations>,
    active: Mutex<Option<Arc<AtomicBool>>>,
}

impl PoetryLibrary {
    pub(crate) fn new(app_data_root: PathBuf, operations: Arc<Operations>) -> Self {
        let temp_dir = app_data_root.join("poetry-tmp");
        if let Err(error) = fs::remove_dir_all(&temp_dir) {
            if error.kind() != std::io::ErrorKind::NotFound {
                crate::runtime_log!("failed to clean stale poetry temp data: {error}");
            }
        }
        Self {
            root: app_data_root,
            operations,
            active: Mutex::new(None),
        }
    }

    pub fn db(&self) -> PoetryDb {
        PoetryDb::new(self.root.join("poetry.sqlite3"))
    }

    fn tmp_dir(&self) -> PathBuf {
        self.root.join("poetry-tmp")
    }

    /// Register an active job; None when another sync is already running.
    fn claim_slot(&self) -> Option<Arc<AtomicBool>> {
        let mut guard = self.active.lock();
        if guard.is_some() {
            return None;
        }
        let flag = Arc::new(AtomicBool::new(false));
        *guard = Some(flag.clone());
        Some(flag)
    }

    fn release_slot(&self) {
        *self.active.lock() = None;
    }

    pub fn cancel_sync(&self) {
        if let Some(flag) = self.active.lock().as_ref() {
            flag.store(true, Ordering::SeqCst);
        }
    }

    pub fn is_active(&self) -> bool {
        self.active.lock().is_some()
    }

    pub fn delete_database(&self) -> AppResult<()> {
        let path = self.root.join("poetry.sqlite3");
        for suffix in ["", "-wal", "-shm"] {
            let target = PathBuf::from(format!("{}{}", path.display(), suffix));
            if target.exists() {
                fs::remove_file(target)
                    .map_err(|error| AppError::from(error).context("delete poetry data"))?;
            }
        }
        let temp_dir = self.tmp_dir();
        if temp_dir.exists() {
            fs::remove_dir_all(temp_dir)
                .map_err(|error| AppError::from(error).context("delete poetry temp data"))?;
        }
        Ok(())
    }

    // ---- status ----

    pub fn collections_status(&self) -> AppResult<Vec<PoetryCollectionStatus>> {
        let catalog = Catalog::load()?;
        let conn = self.db().open()?;
        // `LENGTH()` counts characters on TEXT, so the poem text is measured
        // through a BLOB cast: UTF-8 Chinese is 3 bytes per character and the
        // character count under-reports the stored size by ~3x.
        let mut stmt = conn.prepare(
            "SELECT collection_id, COUNT(*),
                    COALESCE(SUM(LENGTH(CAST(body AS BLOB)) + LENGTH(CAST(notes AS BLOB))
                               + LENGTH(CAST(strains AS BLOB)) + LENGTH(CAST(title AS BLOB))
                               + LENGTH(CAST(author AS BLOB)) + LENGTH(CAST(chapter AS BLOB))
                               + LENGTH(CAST(rhythmic AS BLOB))), 0)
             FROM poems GROUP BY collection_id",
        )?;
        let stats: std::collections::HashMap<String, (i64, i64)> = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .map(|(id, count, bytes)| (id, (count, bytes)))
            .collect();

        let rows: Vec<(String, i64, String)> = {
            let mut stmt = conn.prepare("SELECT id, poem_count, source_sha FROM collections")?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            rows
        };
        let installed: std::collections::HashMap<String, (i64, String)> = rows
            .into_iter()
            .map(|(id, count, sha)| (id, (count, sha)))
            .collect();

        Ok(catalog
            .collections
            .iter()
            .map(|spec| {
                let entry = installed.get(&spec.id);
                let bytes = stats.get(&spec.id).map(|(_, bytes)| *bytes).unwrap_or(0);
                PoetryCollectionStatus {
                    id: spec.id.clone(),
                    name: spec.name.clone(),
                    dynasty: spec.dynasty.clone(),
                    script: spec.script,
                    tier: spec.tier,
                    installed: entry.is_some(),
                    poem_count: entry.map(|(count, _)| *count).unwrap_or(0),
                    bytes_used: bytes,
                    source_sha: entry.map(|(_, sha)| sha.clone()).unwrap_or_default(),
                }
            })
            .collect())
    }

    pub fn content_index_status(&self) -> AppResult<PoetryContentIndexStatus> {
        let enabled = self
            .db()
            .meta_get(super::db::META_BODY_INDEX_ENABLED)?
            .as_deref()
            == Some("1");
        let indexed = if enabled {
            let conn = self.db().open()?;
            conn.query_row("SELECT COUNT(*) FROM poems_body_fts", [], |row| row.get(0))?
        } else {
            0
        };
        Ok(PoetryContentIndexStatus {
            enabled,
            indexed_poems: indexed,
        })
    }

    pub fn rebuild_body_index(
        &self,
        enable: bool,
        on_progress: impl Fn(i64, i64) + Send + Sync,
    ) -> AppResult<()> {
        self.db().rebuild_body_index(enable, on_progress)
    }

    pub fn delete_collection(&self, id: &str) -> AppResult<()> {
        self.db().delete_collection(id)?;
        Ok(())
    }

    // ---- sync plan ----

    pub fn sync_plan(&self, fetch_remote: bool) -> AppResult<PoetrySyncPlan> {
        let catalog = Catalog::load()?;
        let statuses = self.collections_status()?;
        let mut plan_sources = Vec::new();
        let mut outdated = Vec::new();

        for source_id in catalog.sources.keys() {
            let source_of = |status: &PoetryCollectionStatus| {
                catalog.collection(&status.id).map(|c| c.source.as_str())
                    == Some(source_id.as_str())
            };
            let remote_sha = if fetch_remote {
                fetch_source_sha(&catalog, source_id).ok()
            } else {
                None
            };
            let local_shas: Vec<&String> = statuses
                .iter()
                .filter(|status| {
                    source_of(status) && status.installed && !status.source_sha.is_empty()
                })
                .map(|status| &status.source_sha)
                .collect();
            if let Some(remote) = &remote_sha {
                for status in statuses.iter().filter(|status| source_of(status)) {
                    if status.installed && &status.source_sha != remote {
                        outdated.push(status.id.clone());
                    }
                }
            }
            plan_sources.push(PoetrySourceStatus {
                id: source_id.clone(),
                upstream_sha: remote_sha,
                local_sha: local_shas.first().map(|sha| (*sha).clone()),
            });
        }
        Ok(PoetrySyncPlan {
            sources: plan_sources,
            outdated,
        })
    }

    // ---- job spawning ----

    /// Detached workers hold their own operation lease until the thread exits,
    /// so maintenance draining and shutdown waiting track the real IO, not
    /// just the spawn request. Admission is checked before the job slot so a
    /// rejected job cannot leave the slot claimed.
    fn spawn_job(
        self: &Arc<Self>,
        thread_name: &'static str,
        error_log: &'static str,
        progress: impl Fn(PoetrySyncProgress) + Send + Sync + 'static,
        job: impl Fn(&Arc<PoetryLibrary>, &ProgressFn<'_>, &AtomicBool) -> AppResult<()>
            + Send
            + Sync
            + 'static,
    ) -> AppResult<()> {
        let lease = self.operations.begin()?;
        let Some(cancelled) = self.claim_slot() else {
            return Err(AppError::custom(CustomErrorCode::PoetrySyncBusy));
        };
        let library = self.clone();
        let spawned = std::thread::Builder::new()
            .name(thread_name.into())
            .spawn(move || {
                let _lease = lease;
                // Third-party IO code can panic. Unwind its resources before
                // releasing admission and always publish a terminal failure.
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    job(&library, &progress, &cancelled)
                }))
                .unwrap_or_else(|_| {
                    Err(AppError::external(
                        "task:panicked",
                        "Poetry background task panicked",
                    ))
                });
                library.release_slot();
                Self::with_terminal_events(progress, result, error_log);
            });
        if let Err(error) = spawned {
            // The dropped closure already released the lease; the slot must
            // not stay claimed for a job that never started.
            self.release_slot();
            return Err(AppError::from(error).context("failed to spawn worker thread"));
        }
        Ok(())
    }

    /// Wrap the caller's progress callback so every job also emits a
    /// terminal `done` / `error` event; the UI keys off those phases.
    fn with_terminal_events(
        progress: impl Fn(PoetrySyncProgress) + Send + Sync + 'static,
        result: AppResult<()>,
        error_log: &str,
    ) {
        let phase = match &result {
            Ok(()) => "done",
            Err(_) => "error",
        };
        progress(PoetrySyncProgress {
            collection_id: "sync".into(),
            phase: phase.into(),
            bytes_done: 0,
            bytes_total: None,
            imported: 0,
            total: None,
            error: result.err().inspect(|error| {
                crate::runtime_log!("{error_log}: {}", error.message);
            }),
        });
    }

    pub fn begin_network_sync(
        self: &Arc<Self>,
        progress: impl Fn(PoetrySyncProgress) + Send + Sync + 'static,
        ids: Vec<String>,
    ) -> AppResult<()> {
        self.spawn_job(
            "poetry-sync",
            "poetry sync failed",
            progress,
            move |library, progress, cancelled| {
                run_network_sync(library, progress, &ids, cancelled)
            },
        )
    }

    #[cfg(any(desktop, test))]
    pub fn begin_local_import(
        self: &Arc<Self>,
        progress: impl Fn(PoetrySyncProgress) + Send + Sync + 'static,
        source_path: String,
        ids: Vec<String>,
    ) -> AppResult<()> {
        self.spawn_job(
            "poetry-import",
            "poetry import failed",
            progress,
            move |library, progress, cancelled| {
                run_local_import(library, progress, Path::new(&source_path), &ids, cancelled)
            },
        )
    }

    pub fn begin_annotations_install(
        self: &Arc<Self>,
        progress: impl Fn(PoetrySyncProgress) + Send + Sync + 'static,
    ) -> AppResult<()> {
        self.spawn_job(
            "poetry-annotations",
            "annotations install failed",
            progress,
            move |library, progress, cancelled| {
                run_annotations_install(library, progress, cancelled)
            },
        )
    }

    // ---- annotations ----

    pub fn annotations_status(&self) -> AppResult<(bool, i64)> {
        if !self.db().exists() {
            return Ok((false, 0));
        }
        let conn = self.db().open()?;
        let count: i64 =
            conn.query_row("SELECT COUNT(*) FROM annotations", [], |row| row.get(0))?;
        Ok((count > 0, count))
    }

    pub fn annotations_delete(&self) -> AppResult<()> {
        if !self.db().exists() {
            return Ok(());
        }
        let conn = self.db().open()?;
        conn.execute("DELETE FROM annotations", [])?;
        self.db().meta_set("annotations_installed", "0")?;
        Ok(())
    }
}

#[cfg(test)]
#[path = "sync_tests.rs"]
mod tests;
