//! Progress pump and shared task-state mapping.

use std::cell::RefCell;
use std::sync::Arc;

use librqbit::{Session, TorrentStatsState};
use tauri::AppHandle;

use super::models::BtTaskState;
use super::{info_hash_hex, PUMP_INTERVAL};
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
                .map(|row| (row.info_hash, (row.package_mode, row.status)))
                .collect::<std::collections::HashMap<_, _>>();
            for (hash, progress, total, finished, phase) in snapshot.into_inner() {
                let task = task_states.get(&hash);
                let is_archive = task.is_some_and(|(package_mode, _)| package_mode == "archive");
                let published = task.is_some_and(|(_, status)| status == "completed");
                // The finalization job records the private output path before
                // the task becomes completed; the progress event follows that
                // persisted state so the UI never settles early.
                let publish_pending = !published;
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
