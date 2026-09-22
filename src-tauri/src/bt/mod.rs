//! BT download engine: application-side wrapper over the librqbit Session.
//!
//! Boundaries:
//! - The engine starts lazily; cross-restart task restore relies on
//!   librqbit's Json persistence (torrent bytes + bitfield). This module
//!   only adds app-side metadata (storage/bt.rs).
//! - Progress flows to the frontend through the shared event channel in
//!   crate::transfer, with task ids prefixed by "bt:".
//! - Platform note: desktop and Android expose the engine independently.
//!   iOS deliberately excludes this module until its socket-layer target
//!   support is available; it never falls back to a desktop process.

mod cancel;
mod download;
mod engine;
mod export;
mod files;
mod finalize;
mod models;
mod playability;
mod probe;
mod staging;
mod stats;
mod stream_server;
mod trackers;

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use librqbit::{AddTorrent, AddTorrentOptions, ManagedTorrent, Session};
use librqbit_core::hash_id::Id20;
use std::cell::RefCell;
use std::collections::HashMap;
use tauri::AppHandle;
use tokio::sync::Mutex;

use crate::error::{AppError, AppResult};
use crate::storage::{bt::BtTaskRow, Storage};
pub use models::{
    BtControlAction, BtDhtState, BtDhtStatus, BtFileListing, BtFileMeta, BtFilePreview,
    BtPackageMode, BtPeerInfo, BtPlayability, BtProbeResult, BtTaskEvent, BtTaskInfo, BtTaskStatus,
};
use stats::task_state;
use stream_server::StreamServer;

/// Magnet cold start (DHT peer discovery + metadata) can be slow; on timeout
/// the user cancels and retries rather than hanging forever.
const PROBE_TIMEOUT: Duration = Duration::from_secs(90);
const PUMP_INTERVAL: Duration = Duration::from_secs(1);

/// The alias is not re-exported at the crate root; use Arc<ManagedTorrent>.
type TorrentHandle = Arc<ManagedTorrent>;

fn dht_state_for_counts(ipv4_nodes: usize, ipv6_nodes: usize, outstanding: usize) -> BtDhtState {
    if ipv4_nodes + ipv6_nodes > 0 {
        BtDhtState::Ready
    } else if outstanding > 0 {
        BtDhtState::Bootstrapping
    } else {
        BtDhtState::NotEstablished
    }
}

pub struct BtManager {
    app: AppHandle,
    storage: Storage,
    engine: Mutex<Option<Engine>>,
    /// Cooperative cancellation flags for the jobs that publish a finished
    /// download: moving a plain file out, packing an archive.
    finalize_jobs: Arc<std::sync::Mutex<HashMap<String, Arc<std::sync::atomic::AtomicBool>>>>,
    /// Serializes publication with task deletion.
    finalize_gate: Arc<Mutex<()>>,
    /// Serialize add/replace decisions per info hash so concurrent duplicate
    /// requests cannot both pass the storage check and delete each other's data.
    add_gates: Mutex<HashMap<String, Arc<Mutex<()>>>>,
}

struct Engine {
    session: Arc<Session>,
    pump_handle: tokio::task::JoinHandle<()>,
    stream_server: Option<StreamServer>,
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
            finalize_jobs: Arc::new(std::sync::Mutex::new(HashMap::new())),
            finalize_gate: Arc::new(Mutex::new(())),
            add_gates: Mutex::new(HashMap::new()),
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

    /// Return platform-local DHT routing and request diagnostics on demand.
    pub async fn dht_status(&self) -> AppResult<BtDhtStatus> {
        let session = self.ensure_engine().await?;
        let Some(dht) = session.get_dht() else {
            return Ok(BtDhtStatus {
                enabled: false,
                ipv4_nodes: 0,
                ipv6_nodes: 0,
                outstanding_requests: 0,
                state: BtDhtState::Disabled,
            });
        };
        let stats = dht.stats();
        Ok(BtDhtStatus {
            enabled: true,
            ipv4_nodes: stats.routing_table_size,
            ipv6_nodes: stats.routing_table_size_v6,
            outstanding_requests: stats.outstanding_requests,
            state: dht_state_for_counts(
                stats.routing_table_size,
                stats.routing_table_size_v6,
                stats.outstanding_requests,
            ),
        })
    }

    pub(super) async fn add_torrent_to_session(
        &self,
        session: &Arc<Session>,
        source: &str,
        only_files: Vec<usize>,
        output_folder: String,
    ) -> AppResult<TorrentHandle> {
        let (source_info, add_source) = if std::path::Path::new(source).is_file() {
            let bytes = std::fs::read(source)
                .map_err(|error| AppError(format!("读取种子文件失败: {error}")))?;
            (
                Some(trackers::inspect_torrent_bytes(&bytes)?),
                AddTorrent::from_bytes(bytes),
            )
        } else if source.starts_with("http://") || source.starts_with("https://") {
            let response = reqwest::get(source)
                .await
                .map_err(|error| AppError(format!("下载种子文件失败: {error}")))?
                .error_for_status()
                .map_err(|error| AppError(format!("下载种子文件失败: {error}")))?;
            let bytes = response
                .bytes()
                .await
                .map_err(|error| AppError(format!("读取种子文件失败: {error}")))?;
            (
                Some(trackers::inspect_torrent_bytes(&bytes)?),
                AddTorrent::from_bytes(bytes),
            )
        } else {
            (
                trackers::inspect_source(source)?,
                AddTorrent::from_url(source),
            )
        };
        let public_trackers = trackers::load_public_trackers(&self.base_dir()?);
        let fallback = trackers::fallback_for_source(source_info.as_ref(), &public_trackers);
        let opts = AddTorrentOptions {
            output_folder: Some(output_folder),
            only_files: (!only_files.is_empty()).then_some(only_files),
            trackers: fallback,
            // Keep newly added tasks aligned with the session-wide swarm cap.
            peer_limit: Some(engine::BT_PEER_LIMIT),
            // overwrite=true is the precondition for resume semantics;
            // idempotency is guaranteed by the bt_tasks table.
            overwrite: true,
            ..Default::default()
        };
        session
            .add_torrent(add_source, Some(opts))
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
        let exported = row
            .export_path
            .as_deref()
            .is_some_and(|output| Path::new(output).is_file());
        let mut info = BtTaskInfo {
            info_hash: row.info_hash.clone(),
            label: row.label,
            download_dir: row.work_dir.clone(),
            output_path: row.output_path.clone(),
            export_path: row.export_path.clone(),
            exported,
            status: persisted_status,
            package_mode,
            file_index: (package_mode == BtPackageMode::Direct)
                .then(|| row.file_indices.first().copied())
                .flatten(),
            file_name: None,
            error: row.last_error,
            total: persisted_total,
            progress: persisted_finished.then_some(persisted_total.unwrap_or(0)),
            finished: persisted_finished,
            peers_live: 0,
            state: None,
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
                            handle
                                .with_metadata(|metadata| {
                                    info.file_index.and_then(|index| {
                                        metadata.file_infos.get(index).map(|file| {
                                            file.relative_filename.to_string_lossy().into_owned()
                                        })
                                    })
                                })
                                .ok()
                                .flatten(),
                        ));
                        break;
                    }
                }
            });
            if let Some((total, progress, finished, peers, error, state, file_name)) =
                snapshot.into_inner()
            {
                info.total = Some(total);
                info.progress = Some(progress);
                info.finished = finished || persisted_finished;
                info.state = Some(state);
                if !matches!(info.status, BtTaskStatus::Completed) {
                    info.finished = false;
                }
                info.peers_live = peers;
                info.file_name = file_name;
                if let Some(error) = error {
                    info.status = BtTaskStatus::Error;
                    info.error = Some(error);
                    info.finished = false;
                }
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
#[path = "dht_tests.rs"]
mod tests;
