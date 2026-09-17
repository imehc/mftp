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
mod engine;
mod export;
mod finalize;
mod models;
mod probe;
mod staging;
mod stats;
mod stream_server;

use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Duration;

use librqbit::{AddTorrent, AddTorrentOptions, ManagedTorrent, Session};
use librqbit_core::hash_id::Id20;
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::sync::Mutex as StdMutex;
use tauri::AppHandle;
use tokio::sync::Mutex;

use crate::error::{AppError, AppResult};
use crate::storage::{bt::BtTaskRow, Storage};
pub use cache::ActiveStreams;
pub use models::{
    BtCacheItem, BtCacheStats, BtControlAction, BtFileMeta, BtPackageMode, BtPeerInfo,
    BtProbeResult, BtTaskEvent, BtTaskInfo, BtTaskStats, BtTaskStatus,
};
use stats::task_state;
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
        let staged = staging::stages_into_part_dir(&row);
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
