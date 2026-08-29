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

/// Display phase for the transfer panel. Chinese by design: the shared
/// progress event carries a ready-to-render phase string.
fn phase_label(state: &TorrentStatsState, finished: bool) -> &'static str {
    match state {
        TorrentStatsState::Initializing { .. } => "获取资源信息…",
        TorrentStatsState::Live if finished => "做种中",
        TorrentStatsState::Live => "下载中",
        TorrentStatsState::Paused => "已暂停",
        TorrentStatsState::Error => "错误",
    }
}

fn task_state(state: &TorrentStatsState, finished: bool) -> BtTaskState {
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
    pub fn task_stats(&self, info_hash: &str) -> AppResult<BtTaskStats> {
        let session = self
            .engine_running()
            .ok_or_else(|| AppError("播放服务未就绪".into()))?;
        let hash = parse_info_hash(info_hash)?;
        let handle = find_handle(&session, &hash)?
            .ok_or_else(|| AppError("任务不存在或尚未初始化".into()))?;
        let stats = handle.stats();
        let finished = !matches!(stats.state, TorrentStatsState::Error)
            && (stats.finished
                || (stats.total_bytes > 0 && stats.progress_bytes >= stats.total_bytes));
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
            progress: stats.progress_bytes,
            total: stats.total_bytes,
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
            let archive_states = storage
                .list_bt_tasks()
                .unwrap_or_default()
                .into_iter()
                .filter(|row| row.package_mode == "archive")
                .map(|row| (row.info_hash, row.status))
                .collect::<std::collections::HashMap<_, _>>();
            for (hash, progress, total, finished, phase) in snapshot.into_inner() {
                let archive_status = archive_states.get(&hash).map(String::as_str);
                let is_archive_pending = matches!(archive_status, Some("active" | "packaging"));
                let archive_finished = matches!(archive_status, Some("completed"));
                emit_transfer_progress_with_finish(
                    &app,
                    &format!("bt:{hash}"),
                    if is_archive_pending && finished {
                        "bt:packaging"
                    } else {
                        phase
                    },
                    progress,
                    Some(total),
                    finished && (archive_status.is_none() || archive_finished),
                );
            }
        }
    })
}
