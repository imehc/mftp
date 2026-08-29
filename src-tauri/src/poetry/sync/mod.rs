//! Sync orchestration: job slot management, status/sync plan, and the
//! annotation pack (D7). Downloading and importing live in the `net` and
//! `ingest` submodules.
//!
//! All heavy work runs on dedicated threads (never the async runtime).
//! Progress flows through an injected callback so tests can observe it
//! without an app handle.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use parking_lot::Mutex;
use serde_json::Value;

use super::catalog::Catalog;
use super::db::{PoetryDb, ANNOTATIONS_COLLECTION_ID};
use super::model::{
    PoetryCollectionStatus, PoetryContentIndexStatus, PoetrySourceStatus, PoetrySyncPlan,
    PoetrySyncProgress,
};
use super::text;
use crate::error::{AppError, AppResult};

mod ingest;
mod net;

use net::{download_tarball, fetch_source_sha, run_network_sync};

use ingest::run_local_import;

/// Event channel shared with the frontend (`src/lib/events.ts`).
pub const SYNC_PROGRESS_EVENT: &str = "library://sync-progress";

type ProgressFn<'a> = dyn Fn(PoetrySyncProgress) + Send + Sync + 'a;

pub struct PoetryLibrary {
    root: PathBuf,
    active: Mutex<Option<Arc<AtomicBool>>>,
}

impl PoetryLibrary {
    pub fn new(app_data_root: PathBuf) -> Self {
        Self {
            root: app_data_root,
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

    // ---- status ----

    pub fn collections_status(&self) -> AppResult<Vec<PoetryCollectionStatus>> {
        let catalog = Catalog::load().map_err(AppError)?;
        let conn = self.db().open()?;
        let mut stmt = conn.prepare(
            "SELECT collection_id, COUNT(*),
                    COALESCE(SUM(LENGTH(body) + LENGTH(notes) + LENGTH(strains)
                                  + LENGTH(title) + LENGTH(author) + LENGTH(chapter)
                                  + LENGTH(rhythmic)), 0)
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
        self.db()
            .rebuild_body_index(enable, |done, total| on_progress(done, total))
    }

    pub fn delete_collection(&self, id: &str) -> AppResult<()> {
        self.db().delete_collection(id)?;
        Ok(())
    }

    // ---- sync plan ----

    pub fn sync_plan(&self, fetch_remote: bool) -> AppResult<PoetrySyncPlan> {
        let catalog = Catalog::load().map_err(AppError)?;
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
            error: result.err().map(|error| {
                eprintln!("{error_log}: {error}");
                error.0
            }),
        });
    }

    pub fn begin_network_sync(
        self: &Arc<Self>,
        progress: impl Fn(PoetrySyncProgress) + Send + Sync + 'static,
        ids: Vec<String>,
    ) -> AppResult<()> {
        let Some(cancelled) = self.claim_slot() else {
            return Err(AppError("another sync is already running".into()));
        };
        let library = self.clone();
        std::thread::Builder::new()
            .name("poetry-sync".into())
            .spawn(move || {
                let result = run_network_sync(&library, &progress, &ids, &cancelled);
                library.release_slot();
                Self::with_terminal_events(progress, result, "poetry sync failed");
            })
            .map_err(|e| AppError(format!("failed to spawn sync thread: {e}")))?;
        Ok(())
    }

    pub fn begin_local_import(
        self: &Arc<Self>,
        progress: impl Fn(PoetrySyncProgress) + Send + Sync + 'static,
        source_path: String,
        ids: Vec<String>,
    ) -> AppResult<()> {
        let Some(cancelled) = self.claim_slot() else {
            return Err(AppError("another sync is already running".into()));
        };
        let library = self.clone();
        std::thread::Builder::new()
            .name("poetry-import".into())
            .spawn(move || {
                let result = run_local_import(
                    &library,
                    &progress,
                    Path::new(&source_path),
                    &ids,
                    &cancelled,
                );
                library.release_slot();
                Self::with_terminal_events(progress, result, "poetry import failed");
            })
            .map_err(|e| AppError(format!("failed to spawn import thread: {e}")))?;
        Ok(())
    }

    pub fn begin_annotations_install(
        self: &Arc<Self>,
        progress: impl Fn(PoetrySyncProgress) + Send + Sync + 'static,
    ) -> AppResult<()> {
        let Some(cancelled) = self.claim_slot() else {
            return Err(AppError("another sync is already running".into()));
        };
        let library = self.clone();
        std::thread::Builder::new()
            .name("poetry-annotations".into())
            .spawn(move || {
                let result = run_annotations_install(&library, &progress, &cancelled);
                library.release_slot();
                Self::with_terminal_events(progress, result, "annotations install failed");
            })
            .map_err(|e| AppError(format!("failed to spawn annotations thread: {e}")))?;
        Ok(())
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

// ---------------------------------------------------------------------------
// Annotation pack (D7)
// ---------------------------------------------------------------------------

fn run_annotations_install(
    library: &Arc<PoetryLibrary>,
    progress: &ProgressFn<'_>,
    cancelled: &AtomicBool,
) -> AppResult<()> {
    #[cfg(not(desktop))]
    {
        let _ = (library, progress, cancelled);
        return Err(AppError(
            "annotation pack downloads require the desktop app".into(),
        ));
    }

    #[cfg(desktop)]
    {
        let catalog = Catalog::load().map_err(AppError)?;
        let tmp = library.tmp_dir();
        fs::create_dir_all(&tmp).map_err(AppError::from)?;
        let result = (|| -> AppResult<()> {
            let archive_path = tmp.join("gushiwen.tar.gz");
            let Some(spec) = catalog.sources.get("gushiwen") else {
                return Err(AppError("missing gushiwen source".into()));
            };
            download_tarball(
                progress,
                spec.repo.clone(),
                spec.branch.clone(),
                &archive_path,
                cancelled,
            )?;
            let extract_dir = tmp.join("extract-gushiwen");
            let _ = fs::remove_dir_all(&extract_dir);
            fs::create_dir_all(&extract_dir).map_err(AppError::from)?;
            extract_all(&archive_path, &extract_dir, cancelled)?;
            import_annotation_jsonl(library, progress, &extract_dir, cancelled)?;
            let _ = fs::remove_dir_all(&extract_dir);
            let _ = fs::remove_file(&archive_path);
            library.db().meta_set("annotations_installed", "1")?;
            Ok(())
        })();
        let _ = fs::remove_dir_all(&tmp);
        result
    }
}

fn extract_all(archive_path: &Path, extract_root: &Path, cancelled: &AtomicBool) -> AppResult<()> {
    let file = fs::File::open(archive_path).map_err(|e| AppError(format!("open archive: {e}")))?;
    let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(file));
    archive.set_preserve_permissions(false);
    for entry in archive
        .entries()
        .map_err(|e| AppError(format!("read archive: {e}")))?
    {
        if cancelled.load(Ordering::SeqCst) {
            return Err(AppError("cancelled".into()));
        }
        let mut entry = entry.map_err(|e| AppError(e.to_string()))?;
        let path = entry
            .path()
            .map_err(|e| AppError(e.to_string()))?
            .into_owned();
        let rel: PathBuf = path.components().skip(1).collect();
        if rel.as_os_str().is_empty() {
            continue;
        }
        let target = extract_root.join(rel);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(AppError::from)?;
        }
        entry
            .unpack(&target)
            .map_err(|e| AppError(format!("unpack: {e}")))?;
    }
    Ok(())
}

fn import_annotation_jsonl(
    library: &Arc<PoetryLibrary>,
    progress: &ProgressFn<'_>,
    dir: &Path,
    cancelled: &AtomicBool,
) -> AppResult<()> {
    // The gushiwen repo ships JSONL content under `.json` names across
    // guwen/ sentence/ writer/; only lines carrying annotation fields are
    // relevant, so filter by content rather than by path.
    let mut json_files = Vec::new();
    collect_matching_suffix(dir, dir, ".json", &mut json_files)?;
    json_files.sort();

    // Pre-count lines so the progress toast can show X / Y.
    let mut total: u32 = 0;
    let mut per_file: Vec<(PathBuf, u32)> = Vec::new();
    for file in &json_files {
        let raw = fs::read_to_string(file)
            .map_err(|e| AppError(format!("read {}: {e}", file.display())))?;
        let lines = raw.lines().filter(|line| !line.trim().is_empty()).count() as u32;
        per_file.push((file.clone(), lines));
        total += lines;
    }

    let conn = library.db().open()?;
    let mut imported: u32 = 0;
    for (file, _lines) in &per_file {
        let raw = fs::read_to_string(file)
            .map_err(|e| AppError(format!("read {}: {e}", file.display())))?;
        for line in raw.lines() {
            if cancelled.load(Ordering::SeqCst) {
                return Err(AppError("cancelled".into()));
            }
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let Ok(value) = serde_json::from_str::<Value>(line) else {
                continue;
            };
            let field = |name: &str| {
                value
                    .get(name)
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .trim()
                    .to_string()
            };
            let remark = field("remark");
            let translation = field("translation");
            let appreciation = field("shangxi");
            // sentence/ writer/ entries carry none of these; skip them.
            if remark.is_empty() && translation.is_empty() && appreciation.is_empty() {
                continue;
            }
            let Some(title) = value.get("title").and_then(Value::as_str) else {
                continue;
            };
            let writer_name = value.get("writer").and_then(Value::as_str).unwrap_or("");
            let key = text::annotation_key(&text::normalize(title), &text::normalize(writer_name));
            conn.execute(
                r#"
                INSERT INTO annotations(match_key, title, writer, remark, translation, appreciation, audio_url)
                VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)
                ON CONFLICT(match_key) DO UPDATE SET
                    remark = excluded.remark,
                    translation = excluded.translation,
                    appreciation = excluded.appreciation,
                    audio_url = excluded.audio_url
                "#,
                rusqlite::params![
                    key,
                    title.trim(),
                    writer_name.trim(),
                    remark,
                    translation,
                    appreciation,
                    field("audioUrl"),
                ],
            )?;
            imported += 1;
            if imported % 500 == 0 {
                progress(PoetrySyncProgress {
                    collection_id: ANNOTATIONS_COLLECTION_ID.into(),
                    phase: "importing".into(),
                    bytes_done: 0,
                    bytes_total: None,
                    imported,
                    total: Some(total),
                    error: None,
                });
            }
        }
    }
    Ok(())
}

fn collect_matching_suffix(
    root: &Path,
    dir: &Path,
    suffix: &str,
    out: &mut Vec<PathBuf>,
) -> AppResult<()> {
    let entries =
        fs::read_dir(dir).map_err(|e| AppError(format!("read {}: {e}", dir.display())))?;
    for entry in entries {
        let entry = entry.map_err(|e| AppError(e.to_string()))?;
        let path = entry.path();
        if path.is_dir() {
            collect_matching_suffix(root, &path, suffix, out)?;
        } else if path.to_string_lossy().ends_with(suffix) {
            out.push(path);
        }
    }
    Ok(())
}
