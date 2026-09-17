//! Engine lifecycle: lazy start, session options, cross-restart task
//! pausing, and shutdown. Split out of `mod` purely to keep the manager
//! file under the size limit.

use anyhow::Context as _;
use std::cell::RefCell;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;

use librqbit::{ListenerOptions, Session, SessionOptions, SessionPersistenceConfig};
use tauri::Manager as _;

use super::stats::spawn_progress_pump;
use super::stream_server::StreamServer;
use super::{fallback_trackers, find_handle, info_hash_hex, parse_info_hash, BtManager, Engine};
use crate::error::{AppError, AppResult};

impl BtManager {
    pub fn has_active_work(&self) -> AppResult<bool> {
        self.storage.has_active_bt_tasks()
    }

    pub(super) fn base_dir(&self) -> AppResult<PathBuf> {
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
    pub(super) async fn ensure_engine(&self) -> AppResult<Arc<Session>> {
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

    pub(super) fn engine_running(&self) -> Option<Arc<Session>> {
        self.engine
            .try_lock()
            .ok()
            .and_then(|g| g.as_ref().map(|e| e.session.clone()))
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
}
