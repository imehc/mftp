//! Progress pump and per-task stats snapshots.
//!
//! Two consumers with different cadences: the pump feeds the global transfer
//! panel through the shared event channel, while `task_stats` answers polls
//! from the preview page footer. Both read `handle.stats()`, so the state
//! mapping lives here once.

use std::cell::RefCell;
use std::sync::Arc;

use librqbit::{Session, TorrentStatsState};
use tauri::AppHandle;

use super::models::{BtTaskState, BtTaskStats};
use super::{find_handle, info_hash_hex, parse_info_hash, BtManager, PUMP_INTERVAL};
use crate::error::{AppError, AppResult};
use crate::storage::Storage;
use crate::transfer::emit_transfer_progress_with_finish;

/// Display phase for the transfer panel. A key rather than prose: the
/// frontend owns the wording (see BT_PHASE_LABELS in src/store/transfers.ts),
/// same convention as the existing "bt:packaging" phase.
fn phase_label(state: &TorrentStatsState, finished: bool) -> &'static str {
    match state {
        TorrentStatsState::Initializing { .. } => "bt:metadata",
        TorrentStatsState::Live if finished => "bt:seeding",
        TorrentStatsState::Live => "bt:downloading",
        TorrentStatsState::Paused => "bt:paused",
        TorrentStatsState::Error => "bt:error",
    }
}

pub(super) fn task_state(state: &TorrentStatsState, finished: bool) -> BtTaskState {
    match state {
        TorrentStatsState::Initializing { .. } => BtTaskState::Initializing,
        TorrentStatsState::Live if finished => BtTaskState::Seeding,
        TorrentStatsState::Live => BtTaskState::Downloading,
        TorrentStatsState::Paused => BtTaskState::Paused,
        TorrentStatsState::Error => BtTaskState::Error,
    }
}

impl BtManager {
    /// Live stats for one task. Errors when the engine is down or the task is
    /// unknown, so the caller can stop polling.
    ///
    /// `file_index` narrows progress/total to that one file: a preview shows a
    /// single file, and a torrent that also carries a few hundred MB of other
    /// files would otherwise report a 400 KB image as "0 B / 788 MB".
    pub fn task_stats(&self, info_hash: &str, file_index: Option<usize>) -> AppResult<BtTaskStats> {
        let session = self
            .engine_running()
            .ok_or_else(|| AppError("播放服务未就绪".into()))?;
        let hash = parse_info_hash(info_hash)?;
        let handle = find_handle(&session, &hash)?
            .ok_or_else(|| AppError("任务不存在或尚未初始化".into()))?;
        let stats = handle.stats();
        // file_progress is indexed like the metadata's file_infos, which is
        // also where BtFileMeta::index comes from (probe keeps the original
        // indices when it drops padding files). Missing entries mean the
        // torrent has not initialized yet; fall back to the whole torrent.
        let file_len = file_index.and_then(|index| {
            handle
                .with_metadata(|md| md.file_infos.get(index).map(|file| file.len))
                .ok()
                .flatten()
        });
        let (progress, total) = match (file_index, file_len) {
            (Some(index), Some(len)) => (stats.file_progress.get(index).copied().unwrap_or(0), len),
            _ => (stats.progress_bytes, stats.total_bytes),
        };
        // Per-file view: "complete" means that file is complete, even while the
        // torrent keeps downloading its siblings.
        let complete = if file_len.is_some() {
            total > 0 && progress >= total
        } else {
            stats.finished || (total > 0 && progress >= total)
        };
        let finished = !matches!(stats.state, TorrentStatsState::Error) && complete;
        let (down_bps, up_bps, peers_live, peers_queued) = stats
            .live
            .as_ref()
            .map(|live| {
                (
                    live.download_speed.as_bytes(),
                    live.upload_speed.as_bytes(),
                    live.snapshot.peer_stats.live,
                    live.snapshot.peer_stats.queued,
                )
            })
            .unwrap_or((0, 0, 0, 0));
        Ok(BtTaskStats {
            info_hash: info_hash.to_string(),
            state: task_state(&stats.state, finished),
            progress,
            total,
            down_bps,
            up_bps,
            peers_live,
            peers_queued,
        })
    }
}

pub(super) fn spawn_progress_pump(
    app: AppHandle,
    session: Arc<Session>,
    storage: Storage,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(PUMP_INTERVAL);
        loop {
            tick.tick().await;
            // with_torrents takes an Fn closure: collect snapshots inside,
            // emit events and mutate state outside.
            let snapshot = RefCell::new(Vec::<(String, u64, u64, bool, &'static str)>::new());
            session.with_torrents(|torrents| {
                for (_, handle) in torrents {
                    let hash = info_hash_hex(handle);
                    let stats = handle.stats();
                    let finished = !matches!(stats.state, TorrentStatsState::Error)
                        && (stats.finished
                            || (stats.total_bytes > 0
                                && stats.progress_bytes >= stats.total_bytes));
                    snapshot.borrow_mut().push((
                        hash,
                        stats.progress_bytes,
                        stats.total_bytes,
                        finished,
                        phase_label(&stats.state, finished),
                    ));
                }
            });
            // Finished torrents are re-announced every tick instead of being
            // muted once: the panel row may be registered after completion
            // (reopened page, task re-added), and the store ignores updates
            // for rows that already settled.
            let rows = storage.list_bt_tasks().unwrap_or_default();
            let task_states = rows
                .into_iter()
                .map(|row| {
                    let staged = super::download::stages_into_part_dir(&row);
                    (row.info_hash, (row.package_mode, row.status, staged))
                })
                .collect::<std::collections::HashMap<_, _>>();
            for (hash, progress, total, finished, phase) in snapshot.into_inner() {
                let task = task_states.get(&hash);
                let is_archive = task.is_some_and(|(package_mode, _, _)| package_mode == "archive");
                let staged = task.is_some_and(|(_, _, staged)| *staged);
                let published = task.is_some_and(|(_, status, _)| status == "completed");
                // The last piece landing is not the end of the task: archives
                // still have to be packed, staged downloads still have to move
                // into the user's folder. Only the finalize job knows when the
                // result is actually there, and it emits the finishing event
                // itself.
                let publish_pending = (is_archive || staged) && !published;
                let phase = match (finished, publish_pending) {
                    (true, true) if is_archive => "bt:packaging",
                    (true, true) => "bt:downloading",
                    _ => phase,
                };
                emit_transfer_progress_with_finish(
                    &app,
                    &format!("bt:{hash}"),
                    phase,
                    progress,
                    Some(total),
                    finished && !publish_pending,
                );
            }
        }
    })
}
