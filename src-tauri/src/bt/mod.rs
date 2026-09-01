//! BT download engine: application-side wrapper over the librqbit Session.
//!
//! Boundaries:
//! - The engine starts lazily; cross-restart task restore relies on
//!   librqbit's Json persistence (torrent bytes + bitfield). This module
//!   only adds app-side metadata (storage/bt.rs).
//! - Progress flows to the frontend through the shared event channel in
//!   crate::transfer, with task ids prefixed by "bt:".
//! - Platform note: the engine is pure Rust and compiles everywhere. Entry
//!   points are desktop-only in the UI; as long as mobile never triggers
//!   ensure_engine there is no network or disk activity.

mod cache;
mod cancel;
mod download;
mod export;
mod models;
mod probe;
mod stats;
mod stream_server;

use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Duration;

use anyhow::Context as _;
use librqbit::{
    AddTorrent, AddTorrentOptions, AddTorrentResponse, ListenerOptions, ManagedTorrent, Session,
    SessionOptions, SessionPersistenceConfig,
};
use librqbit_core::hash_id::Id20;
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::sync::Mutex as StdMutex;
use tauri::{AppHandle, Manager as _};
use tokio::sync::Mutex;

use crate::error::{AppError, AppResult};
use crate::storage::{bt::BtTaskRow, Storage};
pub use cache::ActiveStreams;
pub use models::{
    BtCacheItem, BtCacheStats, BtControlAction, BtFileMeta, BtPackageMode, BtPeerInfo,
    BtProbeResult, BtTaskEvent, BtTaskInfo, BtTaskStats, BtTaskStatus,
};
use probe::{handle_to_probe, probe_from_info, source_info_hash, torrent_bytes_to_probe};
use stats::{spawn_progress_pump, task_state};
use stream_server::StreamServer;

/// Magnet cold start (DHT peer discovery + metadata) can be slow; on timeout
/// the user cancels and retries rather than hanging forever.
const PROBE_TIMEOUT: Duration = Duration::from_secs(90);
const PUMP_INTERVAL: Duration = Duration::from_secs(1);

/// Trackers announced for every non-private torrent on top of whatever the
/// source carries. Bare magnets (`magnet:?xt=…` with no `tr=`) are common —
/// including the ones this app hands out — and without trackers DHT is the
/// only way to find peers, which is why such a task can sit at 0 forever.
/// librqbit keeps private torrents on their own tracker (session.rs:1557).
const FALLBACK_TRACKERS: [&str; 6] = [
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.demonii.com:1337/announce",
    "udp://tracker.openbittorrent.com:6969/announce",
    "udp://exodus.desync.com:6969/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://open.stealth.si:80/announce",
];

fn fallback_trackers() -> HashSet<url::Url> {
    FALLBACK_TRACKERS
        .iter()
        .filter_map(|tracker| tracker.parse().ok())
        .collect()
}

/// The alias is not re-exported at the crate root; use Arc<ManagedTorrent>.
type TorrentHandle = Arc<ManagedTorrent>;

pub struct BtManager {
    app: AppHandle,
    storage: Storage,
    engine: Mutex<Option<Engine>>,
    /// Playback connection count (infohash -> connections); basis for the
    /// active-stream exemption from LRU eviction.
    active_streams: ActiveStreams,
    /// In-flight save-to-local tasks, guarding against duplicate queues.
    pending_saves: Arc<StdMutex<HashSet<String>>>,
    /// Cooperative cancellation flags for the jobs that publish a finished
    /// download: moving a plain file out, packing an archive.
    finalize_jobs: Arc<StdMutex<HashMap<String, Arc<AtomicBool>>>>,
    /// Serializes publication with task deletion.
    finalize_gate: Arc<Mutex<()>>,
}

struct Engine {
    session: Arc<Session>,
    pump_handle: tokio::task::JoinHandle<()>,
    server: StreamServer,
}

fn info_hash_hex(handle: &TorrentHandle) -> String {
    handle.info_hash().as_string()
}

/// Mask IPs for display: keep the first two IPv4 octets, mask everything
/// else. Never expose full addresses through this path.
fn mask_addr(addr: &str) -> String {
    let Some((host, port)) = addr.rsplit_once(':') else {
        return "<masked>".into();
    };
    let octets: Vec<&str> = host.split('.').collect();
    if octets.len() == 4 {
        format!("{}.{}.*.*:{}", octets[0], octets[1], port)
    } else {
        format!("[masked]:{port}")
    }
}

/// 40-char hex -> engine hash type. Frontend ids always come from as_string().
fn parse_info_hash(hex_str: &str) -> AppResult<Id20> {
    if hex_str.len() != 40 || !hex_str.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(AppError("无效的 infohash".into()));
    }
    let bytes = (0..20)
        .map(|i| u8::from_str_radix(&hex_str[i * 2..i * 2 + 2], 16))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| AppError("无效的 infohash".into()))?;
    Id20::from_bytes(&bytes).map_err(|e| AppError(format!("解析 infohash 失败: {e}")))
}

impl BtManager {
    pub fn new(app: AppHandle, storage: Storage) -> Self {
        Self {
            app,
            storage,
            engine: Mutex::new(None),
            active_streams: Arc::new(StdMutex::new(HashMap::new())),
            pending_saves: Arc::new(StdMutex::new(HashSet::new())),
            finalize_jobs: Arc::new(StdMutex::new(HashMap::new())),
            finalize_gate: Arc::new(Mutex::new(())),
        }
    }

    fn base_dir(&self) -> AppResult<PathBuf> {
        let dir = self
            .app
            .path()
            .app_data_dir()
            .map_err(|e| AppError(format!("无法定位应用数据目录: {e}")))?;
        Ok(dir.join("bt"))
    }

    /// Start the engine lazily. Json persistence restores the previous
    /// session's torrents automatically on startup, so replaying rows from
    /// the storage table here is unnecessary.
    async fn ensure_engine(&self) -> AppResult<Arc<Session>> {
        let mut guard = self.engine.lock().await;
        if let Some(engine) = guard.as_ref() {
            return Ok(engine.session.clone());
        }
        let base = self.base_dir()?;
        let session_dir = base.join("session");
        let data_dir = base.join("data");
        std::fs::create_dir_all(&session_dir)?;
        std::fs::create_dir_all(&data_dir)?;

        let session = Session::new_with_opts(
            data_dir,
            SessionOptions {
                persistence: Some(SessionPersistenceConfig::Json {
                    folder: Some(session_dir),
                }),
                // Without a listener the engine can only dial out, so peers
                // that are themselves behind NAT are unreachable — half the
                // swarm on a low-seed torrent. UPnP asks the router for a
                // port so they can dial back; it degrades silently to
                // outgoing-only when the router refuses.
                listen: Some(ListenerOptions {
                    enable_upnp_port_forwarding: true,
                    ..Default::default()
                }),
                // Trust the persisted bitfield (spot-checked, full re-hash on
                // mismatch) instead of re-reading every existing file at each
                // start, which showed up as a long "Initializing" at 0.
                fastresume: true,
                // Sizes the session's blocking-IO semaphore (default 8). Every
                // open playback stream holds one permit for its whole life, and
                // piece writeback takes permits from the same pool — with the
                // default a couple of streams noticeably starve downloads.
                runtime_worker_threads: Some(16),
                trackers: fallback_trackers(),
                ..Default::default()
            },
        )
        .await
        .context("failed to start BT engine")
        .map_err(|e| AppError(format!("{e:#}")))?;

        let pump_handle =
            spawn_progress_pump(self.app.clone(), session.clone(), self.storage.clone());
        let server = StreamServer::spawn(session.clone(), self.active_streams.clone())
            .await
            .ok_or_else(|| AppError("播放服务创建失败".into()))?;
        *guard = Some(Engine {
            session: session.clone(),
            pump_handle,
            server,
        });
        self.pause_restored_torrents(&session).await;
        self.resume_finalize_jobs(&session).await;
        self.cleanup_orphan_owned_dirs(&session);
        Ok(session)
    }

    /// librqbit's persistence restores `is_paused` verbatim, so torrents that
    /// were running at shutdown resume the moment the engine starts — history
    /// silently burning bandwidth the user never asked for. Park everything
    /// instead and let explicit actions (resume, preview, re-download) start
    /// traffic. Archive tasks are exempt: `resume_finalize_jobs` needs them
    /// downloading to finish packaging.
    async fn pause_restored_torrents(&self, session: &Arc<Session>) {
        let archive_pending: HashSet<String> = self
            .storage
            .list_bt_archive_tasks()
            .unwrap_or_default()
            .into_iter()
            .filter(|row| row.status == "active" || row.status == "packaging")
            .map(|row| row.info_hash)
            .collect();
        let handles = RefCell::new(Vec::new());
        session.with_torrents(|torrents| {
            for (_, handle) in torrents {
                if !archive_pending.contains(&info_hash_hex(handle)) {
                    handles.borrow_mut().push(handle.clone());
                }
            }
        });
        for handle in handles.into_inner() {
            let _ = session.pause(&handle).await;
        }
    }

    /// Undo `pause_restored_torrents` for one task. Every explicit user entry
    /// point (resume, preview, streaming, re-download) goes through this, or
    /// the action would look like it did nothing.
    pub(super) async fn unpause_task(&self, session: &Arc<Session>, info_hash: &str) {
        let Ok(hash) = parse_info_hash(info_hash) else {
            return;
        };
        let Ok(Some(handle)) = find_handle(session, &hash) else {
            return;
        };
        if matches!(handle.stats().state, librqbit::TorrentStatsState::Paused) {
            let _ = session.unpause(&handle).await;
        }
    }

    /// Resolve magnet/torrent metadata (list-only, zero disk writes).
    pub async fn probe(&self, source: &str) -> AppResult<BtProbeResult> {
        let local = PathBuf::from(source);
        if local.is_file() {
            let bytes =
                std::fs::read(&local).map_err(|e| AppError(format!("读取种子文件失败: {e}")))?;
            return torrent_bytes_to_probe(&bytes);
        }
        if !source.starts_with("magnet:") && !source.starts_with("http") {
            return Err(AppError("仅支持磁力链接或 .torrent 文件路径".into()));
        }
        let session = self.ensure_engine().await?;
        let resp = tokio::time::timeout(
            PROBE_TIMEOUT,
            session.add_torrent(
                AddTorrent::from_url(source),
                Some(AddTorrentOptions {
                    list_only: true,
                    ..Default::default()
                }),
            ),
        )
        .await
        .map_err(|_| AppError("获取资源信息超时，请检查网络或稍后重试".into()))?
        .map_err(|e| AppError(format!("获取资源信息失败: {e:#}")))?;

        match resp {
            AddTorrentResponse::ListOnly(listed) => {
                probe_from_info(&listed.info, listed.info_hash.as_string())
            }
            AddTorrentResponse::AlreadyManaged(_, handle) => handle_to_probe(&handle),
            AddTorrentResponse::Added(..) => Err(AppError("内部状态异常：probe 不应落盘".into())),
        }
    }

    pub async fn list(&self) -> AppResult<Vec<BtTaskInfo>> {
        self.ensure_engine().await?;
        Ok(self
            .storage
            .list_bt_tasks()?
            .into_iter()
            .map(|row| self.task_info_with_live(row))
            .collect())
    }

    pub async fn control(
        &self,
        info_hash: &str,
        action: BtControlAction,
        delete_files: bool,
    ) -> AppResult<()> {
        let hash = parse_info_hash(info_hash)?;
        match action {
            BtControlAction::Cancel => {
                let session = self.ensure_engine().await?;
                self.cancel_task(&session, info_hash).await?;
            }
            BtControlAction::Remove => {
                let session = self.ensure_engine().await?;
                self.remove_task_data(&session, info_hash, delete_files)
                    .await?;
            }
            BtControlAction::Pause | BtControlAction::Resume => {
                let session = self.ensure_engine().await?;
                let handle = find_handle(&session, &hash)?
                    .ok_or_else(|| AppError("任务不存在或尚未初始化".into()))?;
                let result = match action {
                    BtControlAction::Pause => session.pause(&handle).await,
                    _ => session.unpause(&handle).await,
                };
                result.map_err(|e| AppError(format!("操作失败: {e:#}")))?;
            }
        }
        Ok(())
    }

    /// Per-peer details (data source for the peers overlay), sorted by
    /// fetched bytes descending.
    pub fn task_peers(&self, info_hash: &str) -> AppResult<Vec<models::BtPeerInfo>> {
        let session = self
            .engine_running()
            .ok_or_else(|| AppError("播放服务未就绪".into()))?;
        let hash = parse_info_hash(info_hash)?;
        let handle = find_handle(&session, &hash)?
            .ok_or_else(|| AppError("任务不存在或尚未初始化".into()))?;
        let live = handle.live().ok_or_else(|| AppError("任务未运行".into()))?;
        let snapshot = live.per_peer_stats_snapshot(Default::default());
        let mut peers: Vec<models::BtPeerInfo> = snapshot
            .peers
            .iter()
            .map(|(addr, stats)| models::BtPeerInfo {
                addr: mask_addr(addr),
                client_name: stats.client_name.clone(),
                fetched_bytes: stats.counters.fetched_bytes,
                uploaded_bytes: stats.counters.uploaded_bytes,
                state: stats.state.to_string(),
            })
            .collect();
        peers.sort_by_key(|p| std::cmp::Reverse(p.fetched_bytes));
        Ok(peers)
    }

    fn engine_running(&self) -> Option<Arc<Session>> {
        self.engine
            .try_lock()
            .ok()
            .and_then(|g| g.as_ref().map(|e| e.session.clone()))
    }

    /// Total bytes of a task's selected files. None while the engine is down
    /// or metadata has not arrived, so callers can fall back to showing the
    /// cached amount alone.
    pub(super) fn task_total_bytes(&self, info_hash: &str) -> Option<u64> {
        let session = self.engine_running()?;
        let hash = parse_info_hash(info_hash).ok()?;
        let handle = find_handle(&session, &hash).ok().flatten()?;
        let total = handle.stats().total_bytes;
        (total > 0).then_some(total)
    }

    /// Task count inside the cache pool (for settings display).
    pub fn preview_task_count(&self) -> usize {
        self.storage
            .list_cache_lru()
            .map(|rows| rows.len())
            .unwrap_or(0)
    }

    /// Called on app exit: abort the progress pump and stream server, then
    /// drop the Session (the cancellation token's drop guard winds the engine
    /// down; fastresume is written incrementally, nothing to flush).
    pub fn shutdown(&self) {
        if let Ok(jobs) = self.finalize_jobs.lock() {
            for cancelled in jobs.values() {
                cancelled.store(true, std::sync::atomic::Ordering::SeqCst);
            }
        }
        if let Ok(mut guard) = self.engine.try_lock() {
            if let Some(engine) = guard.take() {
                engine.pump_handle.abort();
                engine.server.accept_task.abort();
            }
        }
    }

    /// Online preview entry: make sure a streamable task exists for the
    /// target file (cache mode) and return its info.
    ///
    /// Resolution order (docs/bt.md §3.3): reuse an existing task; local
    /// .torrent yields the infohash offline; magnets must be v1 40-hex.
    pub async fn ensure_preview_task(
        &self,
        source: &str,
        file_index: usize,
    ) -> AppResult<BtTaskInfo> {
        let hash_hex = source_info_hash(source)?;
        if let Some(mut row) = self.storage.get_bt_task(&hash_hex)? {
            let completed_archive = is_completed_archive(&row.status, &row.package_mode);
            // Reuse the existing task; lazy start restores handles via
            // persistence when the engine was down.
            let session = self.ensure_engine().await?;
            let hash = parse_info_hash(&hash_hex)?;
            match find_handle(&session, &hash)? {
                // Previewing another file of the same torrent: the engine only
                // downloads what is selected, so add this file to the
                // selection instead of waiting forever on a stalled stream.
                Some(handle) => {
                    let mut wanted: HashSet<usize> = handle
                        .only_files()
                        .unwrap_or_default()
                        .into_iter()
                        .collect();
                    if !wanted.is_empty() && wanted.insert(file_index) {
                        session
                            .update_only_files(&handle, &wanted)
                            .await
                            .map_err(|e| AppError(format!("更新文件选择失败: {e:#}")))?;
                    }
                    self.unpause_task(&session, &hash_hex).await;
                }
                None => {
                    // A completed archive no longer has an engine handle. Its
                    // preview must stay ephemeral so the persisted archive
                    // state never returns to active/packaging.
                    let output_folder = if completed_archive {
                        self.cache_root()?
                            .join(&hash_hex)
                            .to_string_lossy()
                            .into_owned()
                    } else {
                        row.dest_dir.clone()
                    };
                    self.add_torrent_to_session(&session, source, vec![file_index], output_folder)
                        .await?;
                    if !completed_archive {
                        row.file_indices = vec![file_index];
                        row.status = "active".into();
                        row.total_bytes = None;
                        row.last_error = None;
                        row.pinned = false;
                        self.storage.upsert_bt_task(&row)?;
                    }
                }
            }
            if !completed_archive {
                let _ = self.storage.touch_bt_access(&hash_hex);
            }
            return Ok(self.task_info_with_live(row));
        }
        let session = self.ensure_engine().await?;
        let dest_dir = self
            .cache_root()?
            .join(&hash_hex)
            .to_string_lossy()
            .into_owned();
        let handle = self
            .add_torrent_to_session(&session, source, vec![file_index], dest_dir.clone())
            .await?;
        let label = handle.name().unwrap_or_else(|| hash_hex.clone());
        let row = BtTaskRow {
            info_hash: hash_hex.clone(),
            label,
            dest_dir: dest_dir.clone(),
            mode: "preview".into(),
            pinned: false,
            created_at: crate::storage::now_ms(),
            work_dir: dest_dir.clone(),
            file_indices: vec![file_index],
            package_mode: "direct".into(),
            status: "active".into(),
            output_path: None,
            total_bytes: None,
            last_error: None,
        };
        self.storage.upsert_bt_task(&row)?;
        let _ = self.storage.touch_bt_access(&hash_hex);
        // Run one quota reclaim pass after the new task lands; failures
        // never block this preview.
        let _ = self.evict_if_needed(&hash_hex).await;
        Ok(self.task_info_with_live(row))
    }

    /// Mint a streaming URL. Starts the engine when needed so the preview
    /// page stays reloadable/deep-linkable (persistence restores the task).
    pub async fn stream_url(&self, info_hash: &str, file_index: usize) -> AppResult<String> {
        let session = self.ensure_engine().await?;
        // Restored tasks come back paused; playing one is an explicit request
        // for traffic, otherwise the stream would stall forever.
        self.unpause_task(&session, info_hash).await;
        let guard = self.engine.lock().await;
        let engine = guard
            .as_ref()
            .ok_or_else(|| AppError("播放服务未就绪".into()))?;
        Ok(engine.server.url_for(info_hash, file_index))
    }

    pub(super) fn cache_root(&self) -> AppResult<PathBuf> {
        let dir = self.base_dir()?.join("cache");
        std::fs::create_dir_all(&dir).map_err(|e| AppError(format!("创建缓存目录失败: {e}")))?;
        Ok(dir)
    }

    pub(super) async fn add_torrent_to_session(
        &self,
        session: &Arc<Session>,
        source: &str,
        only_files: Vec<usize>,
        output_folder: String,
    ) -> AppResult<TorrentHandle> {
        let opts = AddTorrentOptions {
            output_folder: Some(output_folder),
            only_files: (!only_files.is_empty()).then_some(only_files),
            // overwrite=true is the precondition for resume semantics;
            // idempotency is guaranteed by the bt_tasks table.
            overwrite: true,
            ..Default::default()
        };
        session
            .add_torrent(AddTorrent::from_url(source), Some(opts))
            .await
            .map_err(|e| AppError(format!("添加下载任务失败: {e:#}")))?
            .into_handle()
            .ok_or_else(|| AppError("资源信息未就绪，请先解析".into()))
    }

    /// Assemble display info from a storage row plus live engine state.
    fn task_info_with_live(&self, row: BtTaskRow) -> BtTaskInfo {
        let persisted_status = match row.status.as_str() {
            "packaging" => BtTaskStatus::Packaging,
            "completed" => BtTaskStatus::Completed,
            "cancelled" => BtTaskStatus::Cancelled,
            "error" => BtTaskStatus::Error,
            _ => BtTaskStatus::Active,
        };
        let package_mode = if row.package_mode == "archive" {
            BtPackageMode::Archive
        } else {
            BtPackageMode::Direct
        };
        let persisted_total = row.total_bytes;
        let persisted_finished = matches!(persisted_status, BtTaskStatus::Completed);
        // A staged download is not done when the last piece lands — the file
        // still has to move into the user's folder, and only the finalize job
        // knows when that happened.
        let staged = download::stages_into_part_dir(&row);
        let cache_available =
            row.mode != "preview" || self.storage.has_bt_access(&row.info_hash).unwrap_or(false);
        let mut info = BtTaskInfo {
            info_hash: row.info_hash.clone(),
            label: row.label,
            dest_dir: row.dest_dir,
            mode: row.mode,
            pinned: row.pinned,
            status: persisted_status,
            package_mode,
            cache_available,
            error: row.last_error,
            total: persisted_total,
            progress: persisted_finished.then_some(persisted_total.unwrap_or(0)),
            finished: persisted_finished,
            peers_live: 0,
            state: None,
            files: Vec::new(),
        };
        if !matches!(persisted_status, BtTaskStatus::Cancelled) {
            let Some(session) = self.engine_running() else {
                return info;
            };
            let snapshot = RefCell::new(None);
            session.with_torrents(|torrents| {
                for (_, handle) in torrents {
                    if info_hash_hex(handle) == info.info_hash {
                        let stats = handle.stats();
                        let error = matches!(stats.state, librqbit::TorrentStatsState::Error)
                            .then(|| stats.error.unwrap_or_else(|| "BT 下载失败".into()));
                        let finished = stats.finished
                            || (stats.total_bytes > 0 && stats.progress_bytes >= stats.total_bytes);
                        *snapshot.borrow_mut() = Some((
                            stats.total_bytes,
                            stats.progress_bytes,
                            finished,
                            stats
                                .live
                                .as_ref()
                                .map(|l| l.snapshot.peer_stats.live)
                                .unwrap_or(0),
                            error,
                            task_state(&stats.state, finished),
                        ));
                        break;
                    }
                }
            });
            if let Some((total, progress, finished, peers, error, state)) = snapshot.into_inner() {
                info.total = Some(total);
                info.progress = Some(progress);
                info.finished = finished || persisted_finished;
                info.state = Some(state);
                if finished
                    && !staged
                    && matches!(info.package_mode, BtPackageMode::Direct)
                    && !matches!(info.status, BtTaskStatus::Error)
                {
                    info.status = BtTaskStatus::Completed;
                }
                if (staged || matches!(info.package_mode, BtPackageMode::Archive))
                    && !matches!(info.status, BtTaskStatus::Completed)
                {
                    info.finished = false;
                }
                info.peers_live = peers;
                if let Some(error) = error {
                    info.status = BtTaskStatus::Error;
                    info.error = Some(error);
                    info.finished = false;
                }
            }
            // Only preview rows need file identity (open / save-as act on one
            // file); plain downloads already sit in the user's folder.
            if info.mode == "preview" {
                info.files = self.selected_file_meta(&session, &info.info_hash, &row.file_indices);
            }
        }
        info
    }
}

/// Compare two directories as the filesystem sees them (symlinks, `..`,
/// trailing separators). Falls back to a literal compare when a path cannot be
/// resolved, which is the conservative answer: "not the same".
fn same_dir(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == b,
    }
}

fn is_completed_archive(status: &str, package_mode: &str) -> bool {
    status == "completed" && package_mode == "archive"
}

fn find_handle(session: &Session, hash: &Id20) -> AppResult<Option<TorrentHandle>> {
    let found = RefCell::new(None);
    session.with_torrents(|torrents| {
        for (_, handle) in torrents {
            if &handle.info_hash() == hash {
                found.borrow_mut().replace(handle.clone());
                break;
            }
        }
    });
    Ok(found.into_inner())
}

#[cfg(test)]
mod tests {
    use super::is_completed_archive;

    #[test]
    fn only_completed_archives_use_ephemeral_preview() {
        assert!(is_completed_archive("completed", "archive"));
        assert!(!is_completed_archive("active", "archive"));
        assert!(!is_completed_archive("completed", "direct"));
    }
}
