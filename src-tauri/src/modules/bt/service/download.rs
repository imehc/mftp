//! BT download setup, staging hand-off, and multi-file archive finalization.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use librqbit::{Session, TorrentStatsState};

use super::export::archive_target;
use super::finalize::{run_finalize_job, FinalizeContext};
use super::staging::remove_owned_hash_dir;
use super::{
    find_handle, info_hash_hex, parse_info_hash, same_dir, BtManager, BtTaskInfo, TorrentHandle,
};
use crate::error::{AppError, AppResult, CustomErrorCode};
use crate::modules::bt::repository::BtTaskRow;
impl BtManager {
    pub async fn add_download(
        &self,
        source: &str,
        expected_info_hash: &str,
        file_indices: Vec<usize>,
    ) -> AppResult<BtTaskInfo> {
        let (expected_info_hash, _operation) = self.task_operation(expected_info_hash).await?;
        if file_indices.is_empty() {
            return Err(AppError::custom(CustomErrorCode::BtSelectionEmpty));
        }
        let package_mode = if file_indices.len() > 1 {
            "archive"
        } else {
            "direct"
        };
        let existing = self.repository.get_bt_task(&expected_info_hash)?;
        // Both modes download out of sight and only publish the finished
        // result: archives need a scratch tree to pack from, plain downloads
        // must not leave a half-written placeholder in the user's folder.
        let work_dir = self.private_download_dir(&expected_info_hash)?;
        std::fs::create_dir_all(&work_dir).map_err(|error| {
            AppError::from(error).context("Create BT download staging directory")
        })?;

        let reuse = existing.as_ref().is_some_and(|row| {
            matches!(row.status.as_str(), "active" | "error" | "cancelled")
                && row.package_mode == package_mode
                && row.file_indices == file_indices
                && same_dir(Path::new(&row.work_dir), &work_dir)
        });
        ensure_existing_task_can_be_added(existing.as_ref(), reuse)?;

        let session = self.ensure_engine().await?;
        if !reuse {
            self.replace_existing_task(&session, &expected_info_hash)
                .await?;
        } else {
            let hash = parse_info_hash(&expected_info_hash)?;
            if let Some(handle) = find_handle(&session, &hash)? {
                if matches!(handle.stats().state, TorrentStatsState::Error) {
                    // The running finalize job holds this handle and would
                    // report the error as the task's outcome moments after the
                    // fresh add succeeds.
                    self.cancel_finalize_job(&expected_info_hash).await?;
                    session.delete(hash.into(), false).await.map_err(|error| {
                        AppError::external(
                            "bt:engine",
                            format!("Failed to reset errored task: {error:#}"),
                        )
                    })?;
                }
            }
        }
        self.align_existing_handle(&session, &expected_info_hash, &file_indices, &work_dir)
            .await?;

        let handle = self
            .add_torrent_to_session(
                &session,
                source,
                file_indices.clone(),
                work_dir.to_string_lossy().into_owned(),
            )
            .await?;
        let actual_hash = info_hash_hex(&handle);
        if actual_hash != expected_info_hash {
            // Whatever was written landed in a work dir we own, so drop it
            // with the torrent instead of leaving it behind.
            let _ = session.delete(handle.info_hash().into(), true).await;
            let _ = std::fs::remove_dir(&work_dir);
            return Err(AppError::custom(CustomErrorCode::BtHashMismatch));
        }

        // Restored tasks come back parked (see pause_restored_torrents);
        // pressing download again is an explicit request to run.
        self.unpause_task(&session, &actual_hash).await;

        let total = validate_selection(&handle, &file_indices)?;
        let label = handle.name().unwrap_or_else(|| actual_hash.clone());
        let output_path = if package_mode == "archive" {
            existing
                .filter(|_| reuse)
                .and_then(|row| row.output_path)
                .map(PathBuf::from)
                .filter(|path| path.extension().is_some_and(|extension| extension == "tar"))
                .unwrap_or_else(|| archive_target(&work_dir, &label))
        } else {
            PathBuf::new()
        };
        let row = BtTaskRow {
            info_hash: actual_hash,
            label,
            dest_dir: String::new(),
            mode: "download".into(),
            pinned: false,
            created_at: crate::storage::now_ms(),
            work_dir: work_dir.to_string_lossy().into_owned(),
            file_indices,
            package_mode: package_mode.into(),
            status: "active".into(),
            output_path: (package_mode == "archive")
                .then(|| output_path.to_string_lossy().into_owned()),
            export_path: None,
            total_bytes: Some(total),
            error: None,
        };
        self.repository.upsert_bt_task(&row)?;
        // Both modes need a watcher: archives are packed, while direct files
        // are marked complete once their private path is fully written.
        self.start_finalize_job(row.clone(), handle);
        Ok(self.task_info_with_live(row))
    }

    pub(super) fn private_download_root(&self) -> AppResult<PathBuf> {
        let root = self.base_dir.join("downloads");
        std::fs::create_dir_all(&root).map_err(|error| {
            AppError::from(error).context("Create BT private download directory")
        })?;
        Ok(root)
    }

    pub(super) fn private_download_dir(&self, info_hash: &str) -> AppResult<PathBuf> {
        parse_info_hash(info_hash)?;
        Ok(self.private_download_root()?.join(info_hash))
    }

    async fn align_existing_handle(
        &self,
        session: &Arc<Session>,
        info_hash: &str,
        file_indices: &[usize],
        work_dir: &Path,
    ) -> AppResult<()> {
        let hash = parse_info_hash(info_hash)?;
        let Some(handle) = find_handle(session, &hash)? else {
            return Ok(());
        };
        if !same_dir(handle.output_folder(), work_dir) {
            return Ok(());
        }
        let wanted: HashSet<usize> = file_indices.iter().copied().collect();
        let current = handle.only_files().map(|files| files.into_iter().collect());
        if current.as_ref() != Some(&wanted) {
            session
                .update_only_files(&handle, &wanted)
                .await
                .map_err(|error| {
                    AppError::external(
                        "bt:engine",
                        format!("Failed to update file selection: {error:#}"),
                    )
                })?;
        }
        Ok(())
    }

    async fn replace_existing_task(
        &self,
        session: &Arc<Session>,
        info_hash: &str,
    ) -> AppResult<()> {
        self.cancel_finalize_job(info_hash).await?;
        let row = self.repository.get_bt_task(info_hash)?;
        let hash = parse_info_hash(info_hash)?;
        if find_handle(session, &hash)?.is_some() {
            let delete_files = row.is_some();
            session
                .delete(hash.into(), delete_files)
                .await
                .map_err(|error| {
                    AppError::external(
                        "bt:engine",
                        format!("Failed to replace existing task: {error:#}"),
                    )
                })?;
        }
        if let Some(row) = row.as_ref() {
            self.remove_owned_task_dir(row)?;
        }
        self.repository.delete_bt_task(info_hash)?;
        self.repository.delete_bt_access(info_hash)?;
        Ok(())
    }

    /// Arm the watcher that turns a finished download into its published
    /// result. One job per task; a second call while one runs is a no-op.
    pub(super) fn start_finalize_job(&self, row: BtTaskRow, handle: TorrentHandle) {
        let Some(completion) = self.finalize_jobs.begin(&row.info_hash) else {
            return;
        };
        let cancelled = completion.cancelled();
        let context = FinalizeContext {
            events: self.events.clone(),
            repository: self.repository.clone(),
            gate: self.finalize_gate.clone(),
            cancelled,
            row,
            handle,
            completion,
        };
        tokio::spawn(async move { run_finalize_job(context).await });
    }

    pub(super) async fn cancel_finalize_job(&self, info_hash: &str) -> AppResult<()> {
        tokio::time::timeout(
            Duration::from_secs(30),
            self.finalize_jobs.cancel(info_hash),
        )
        .await
        .map_err(|_| AppError::custom(CustomErrorCode::BtFinalizeCancelTimeout))
    }

    pub(super) async fn resume_finalize_jobs(&self, session: &Arc<Session>) {
        self.resume_archive_jobs(session).await;
        self.resume_direct_jobs(session).await;
    }

    /// Re-arm plain downloads. Their file may well have completed while the app
    /// was closed, in which case the job moves it out on the first tick.
    /// Without a handle the engine lost the torrent; leave the row active and
    /// let re-adding it restore both.
    async fn resume_direct_jobs(&self, session: &Arc<Session>) {
        let Ok(rows) = self.repository.list_bt_direct_downloads() else {
            return;
        };
        for row in rows {
            let Ok(hash) = parse_info_hash(&row.info_hash) else {
                continue;
            };
            if let Ok(Some(handle)) = find_handle(session, &hash) {
                self.start_finalize_job(row, handle);
            }
        }
    }

    async fn resume_archive_jobs(&self, session: &Arc<Session>) {
        let Ok(rows) = self.repository.list_bt_archive_tasks() else {
            return;
        };
        for row in rows {
            let Ok(hash) = parse_info_hash(&row.info_hash) else {
                continue;
            };
            let output_exists = row
                .output_path
                .as_deref()
                .map(Path::new)
                .is_some_and(Path::is_file);
            if row.status == "completed" {
                if find_handle(session, &hash).ok().flatten().is_some() {
                    let _ = session.delete(hash.into(), false).await;
                }
                continue;
            }
            if output_exists && row.status == "packaging" {
                if find_handle(session, &hash).ok().flatten().is_some() {
                    let _ = session.delete(hash.into(), false).await;
                }
                let _ = self.repository.update_bt_task_state(
                    &row.info_hash,
                    "completed",
                    row.output_path.as_deref(),
                    None,
                );
                super::super::ports::emit_task(
                    &self.events,
                    super::BtTaskEvent::PackageCompleted {
                        info_hash: row.info_hash.clone(),
                    },
                );
                continue;
            }
            if let Ok(Some(handle)) = find_handle(session, &hash) {
                self.start_finalize_job(row, handle);
            } else {
                let _ = self.repository.update_bt_task_state(
                    &row.info_hash,
                    "error",
                    None,
                    Some(&AppError::custom(CustomErrorCode::BtSessionRestoreFailed)),
                );
            }
        }
    }

    pub(super) fn remove_owned_task_dir(&self, row: &BtTaskRow) -> AppResult<()> {
        remove_owned_hash_dir(
            &self.private_download_root()?,
            Path::new(&row.work_dir),
            &row.info_hash,
        )
    }

    pub(super) fn cleanup_orphan_owned_dirs(&self, session: &Session) {
        let mut referenced = HashSet::new();
        let roots: HashSet<PathBuf> = [self.private_download_root()]
            .into_iter()
            .flatten()
            .collect();
        if let Ok(rows) = self.repository.list_bt_tasks() {
            for row in rows {
                if row.dest_dir.is_empty() {
                    referenced.insert(PathBuf::from(row.work_dir));
                }
            }
        }
        let session_dirs = std::cell::RefCell::new(Vec::new());
        session.with_torrents(|torrents| {
            for (_, handle) in torrents {
                session_dirs
                    .borrow_mut()
                    .push(handle.output_folder().to_path_buf());
            }
        });
        referenced.extend(session_dirs.into_inner());
        for root in &roots {
            let Ok(entries) = std::fs::read_dir(root) else {
                continue;
            };
            for entry in entries.flatten() {
                let is_directory = entry
                    .file_type()
                    .map(|file_type| file_type.is_dir())
                    .unwrap_or(false);
                let path = entry.path();
                let owned_hash_dir = path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| parse_info_hash(name).is_ok());
                if owned_hash_dir && is_directory && !referenced.contains(&path) {
                    let _ = std::fs::remove_dir_all(path);
                }
            }
        }
    }
}

fn ensure_existing_task_can_be_added(existing: Option<&BtTaskRow>, reuse: bool) -> AppResult<()> {
    let Some(row) = existing else {
        return Ok(());
    };
    match row.status.as_str() {
        "active" if reuse => Ok(()),
        "error" | "cancelled" => Ok(()),
        "completed" => Err(AppError::custom(CustomErrorCode::BtReaddCompleted)),
        "packaging" => Err(AppError::custom(CustomErrorCode::BtReaddPackaging)),
        "active" => Err(AppError::custom(CustomErrorCode::BtReaddActiveSelection)),
        _ => Err(AppError::custom(CustomErrorCode::BtReaddConflict)),
    }
}

fn validate_selection(handle: &TorrentHandle, file_indices: &[usize]) -> AppResult<u64> {
    let selected: HashSet<usize> = file_indices.iter().copied().collect();
    if selected.len() != file_indices.len() {
        return Err(AppError::custom(CustomErrorCode::BtSelectionDuplicate));
    }
    let (valid, total) = handle
        .with_metadata(|metadata| {
            let mut valid = 0usize;
            let mut total = 0u64;
            for (index, file) in metadata.file_infos.iter().enumerate() {
                if selected.contains(&index) && !file.attrs.padding {
                    valid += 1;
                    total += file.len;
                }
            }
            (valid, total)
        })
        .map_err(|error| {
            AppError::external(
                "bt:metadata",
                format!("Failed to read torrent metadata: {error:#}"),
            )
        })?;
    if valid != selected.len() {
        return Err(AppError::custom(CustomErrorCode::BtSelectionInvalid));
    }
    Ok(total)
}

#[cfg(test)]
#[path = "download_tests.rs"]
mod tests;
