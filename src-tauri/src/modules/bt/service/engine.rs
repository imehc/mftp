//! Engine lifecycle: lazy start, session options, cross-restart task
//! pausing, and shutdown. Split out of `mod` purely to keep the manager
//! file under the size limit.

use anyhow::Context as _;
use std::cell::RefCell;
use std::collections::HashSet;
use std::path::Path;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

use librqbit::{
    dht::DhtPersistenceConfig, DhtSessionConfig, ListenerOptions, Session, SessionOptions,
    SessionPersistenceConfig,
};

use super::stats::spawn_progress_pump;
use super::{find_handle, info_hash_hex, parse_info_hash, BtManager, Engine};
use crate::error::{AppError, AppResult, CustomErrorCode};

pub(super) const BT_INIT_CONCURRENCY: usize = 2;
pub(super) const BT_PEER_LIMIT: usize = 64;
pub(super) const BT_DHT_DUMP_INTERVAL: Duration = Duration::from_secs(60);

fn dht_config(base: &Path) -> DhtSessionConfig {
    DhtSessionConfig {
        persistence: Some(DhtPersistenceConfig {
            dump_interval: Some(BT_DHT_DUMP_INTERVAL),
            config_filename: Some(base.join("dht.json")),
        }),
        ..Default::default()
    }
}

impl BtManager {
    pub fn has_active_work(&self) -> AppResult<bool> {
        self.repository.has_active_bt_tasks()
    }

    /// Start the engine lazily. Json persistence restores the previous
    /// session's torrents automatically on startup, so replaying rows from
    /// the storage table here is unnecessary.
    pub(super) async fn ensure_engine(&self) -> AppResult<Arc<Session>> {
        let mut guard = self.engine.lock().await;
        if self.stopping.load(Ordering::SeqCst) {
            return Err(AppError::custom(CustomErrorCode::AppShuttingDown));
        }
        if guard.as_ref().is_some_and(|engine| engine.stopping) {
            // A cancelled reset waiter leaves cleanup ownership here. Finish it
            // before serving a later request with a fresh engine.
            self.stop_engine(&mut guard).await;
            if self.stopping.load(Ordering::SeqCst) {
                return Err(AppError::custom(CustomErrorCode::AppShuttingDown));
            }
        }
        if let Some(engine) = guard.as_ref() {
            return Ok(engine.session.clone());
        }
        let base = &self.base_dir;
        let session_dir = base.join("session");
        let data_dir = base.join("data");
        std::fs::create_dir_all(&session_dir)?;
        std::fs::create_dir_all(&data_dir)?;

        let session = Session::new_with_opts(
            data_dir,
            SessionOptions {
                // Keep the routing table in the same platform-local BT data
                // directory as the session, so restarts do not rebuild DHT
                // state and desktop/mobile instances remain independent.
                dht: Some(dht_config(&base)),
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
                // Bound startup work and swarm fan-out so a large restored
                // library cannot monopolize the local device.
                concurrent_init_limit: Some(BT_INIT_CONCURRENCY),
                peer_limit: Some(BT_PEER_LIMIT),
                ..Default::default()
            },
        )
        .await
        .context("failed to start BT engine")
        .map_err(|e| AppError::external("bt:startup", format!("{e:#}")))?;

        let pump = spawn_progress_pump(
            self.events.clone(),
            session.clone(),
            self.repository.clone(),
        );
        let stream_server =
            super::stream_server::StreamServer::spawn(session.clone(), self.repository.clone())
                .await;
        *guard = Some(Engine {
            session: session.clone(),
            pump,
            stream_server,
            stopping: false,
        });
        self.cleanup_legacy_bt_tasks(&session).await;
        self.pause_restored_torrents(&session).await;
        self.resume_finalize_jobs(&session).await;
        self.cleanup_orphan_owned_dirs(&session);
        // Shutdown waits for this same lock, including initialization. Do not
        // hand a newly initialized engine back to a caller after stop was requested.
        if self.stopping.load(Ordering::SeqCst) {
            return Err(AppError::custom(CustomErrorCode::AppShuttingDown));
        }
        Ok(session)
    }

    /// Remove rows created before every task moved into the app-private
    /// download directory. Their user-directory files are left untouched.
    async fn cleanup_legacy_bt_tasks(&self, session: &Arc<Session>) {
        let rows = self.repository.list_bt_tasks().unwrap_or_default();
        for row in rows
            .into_iter()
            .filter(|row| row.mode == "preview" || !row.dest_dir.is_empty())
        {
            if let Ok(hash) = parse_info_hash(&row.info_hash) {
                let _ = session.delete(hash.into(), false).await;
            }
            let _ = self.repository.delete_bt_access(&row.info_hash);
            let _ = self.repository.delete_bt_task(&row.info_hash);
        }
        let _ = self.repository.finish_bt_download_only_migration();
    }

    /// librqbit's persistence restores `is_paused` verbatim, so torrents that
    /// were running at shutdown resume the moment the engine starts — history
    /// silently burning bandwidth the user never asked for. Park everything
    /// instead and let explicit actions (resume, preview, re-download) start
    /// traffic. Archive tasks are exempt: `resume_finalize_jobs` needs them
    /// downloading to finish packaging.
    async fn pause_restored_torrents(&self, session: &Arc<Session>) {
        let archive_pending: HashSet<String> = self
            .repository
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
        if self.stopping.load(Ordering::SeqCst) {
            return None;
        }
        self.engine.try_lock().ok().and_then(|g| {
            g.as_ref()
                .filter(|engine| !engine.stopping)
                .map(|e| e.session.clone())
        })
    }

    /// Wait for application-owned background work. librqbit 9.0.1's stop only
    /// requests cancellation; this is NOT a barrier permitting data deletion.
    pub async fn shutdown(&self) {
        self.stopping.store(true, Ordering::SeqCst);
        let finalized = self.finalize_jobs.close();
        // Queued calls recheck the exit flag after admission. Existing calls and
        // their blocking children must drain before the engine can be stopped.
        let _maintenance = self.admission.maintenance().await;
        self.stop_background_work().await;
        finalized.await;
    }

    /// Legacy reset also stops the background services, but must allow later
    /// startup. Callers hold maintenance admission; third-party quiescence is
    /// separate, so returning here does not prove engine-owned data is unused.
    pub async fn stop_background_work(&self) {
        let mut guard = self.engine.lock().await;
        self.stop_engine(&mut guard).await;
    }

    async fn stop_engine(&self, guard: &mut Option<Engine>) {
        let finalized = self.finalize_jobs.cancel_all();
        if let Some(engine) = guard.as_mut() {
            engine.stopping = true;
            engine.pump.cancel();
            if let Some(server) = engine.stream_server.as_mut() {
                server.cancel();
                server.stop().await;
            }
            engine.pump.wait().await;
        }
        finalized.await;
        if let Some(engine) = guard.as_ref() {
            engine.session.stop().await;
        }
        // Keep the engine registered across awaits so a dropped shutdown waiter
        // cannot lose its cleanup handles. Concurrent shutdown callers serialize.
        guard.take();
    }
}

#[cfg(test)]
#[path = "engine_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "engine_shutdown_tests.rs"]
mod shutdown_tests;
