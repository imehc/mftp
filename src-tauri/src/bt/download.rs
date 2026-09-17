//! BT download setup, staging hand-off, and multi-file archive finalization.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use librqbit::{Session, TorrentStatsState};

use super::export::archive_target;
use super::finalize::{run_finalize_job, FinalizeContext};
use super::staging::{
    part_dir_for, part_root, remove_owned_hash_dir, remove_part_dir, stages_into_part_dir,
};
use super::{
    find_handle, info_hash_hex, parse_info_hash, same_dir, BtManager, BtTaskInfo, TorrentHandle,
};
use crate::error::{AppError, AppResult};
use crate::storage::bt::BtTaskRow;
impl BtManager {
    pub async fn add_download(
        &self,
        source: &str,
        expected_info_hash: &str,
        file_indices: Vec<usize>,
        dest_dir: String,
    ) -> AppResult<BtTaskInfo> {
        if dest_dir.trim().is_empty() {
            return Err(AppError("下载目录不能为空".into()));
        }
        if file_indices.is_empty() {
            return Err(AppError("至少选择一个文件".into()));
        }
        parse_info_hash(expected_info_hash)?;
        let expected_info_hash = expected_info_hash.to_ascii_lowercase();
        std::fs::create_dir_all(&dest_dir)
            .map_err(|error| AppError(format!("创建下载目录失败: {error}")))?;

        let package_mode = if file_indices.len() > 1 {
            "archive"
        } else {
            "direct"
        };
        // Both modes download out of sight and only publish the finished
        // result: archives need a scratch tree to pack from, plain downloads
        // must not leave a half-written placeholder in the user's folder.
        let work_dir = if package_mode == "archive" {
            self.staging_dir_for(&expected_info_hash)?
        } else {
            part_dir_for(Path::new(&dest_dir), &expected_info_hash)
        };
        std::fs::create_dir_all(&work_dir)
            .map_err(|error| AppError(format!("创建下载暂存目录失败: {error}")))?;

        let session = self.ensure_engine().await?;
        let existing = self.storage.get_bt_task(&expected_info_hash)?;
        let reuse = existing.as_ref().is_some_and(|row| {
            row.status != "completed"
                && row.dest_dir == dest_dir
                && row.package_mode == package_mode
                && row.file_indices == file_indices
                && same_dir(Path::new(&row.work_dir), &work_dir)
        });
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
                    self.cancel_finalize_job(&expected_info_hash);
                    self.wait_for_finalize_job(&expected_info_hash).await?;
                    session
                        .delete(hash.into(), false)
                        .await
                        .map_err(|error| AppError(format!("重置失败任务失败: {error:#}")))?;
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
            return Err(AppError("资源标识与解析结果不一致".into()));
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
                .unwrap_or_else(|| archive_target(Path::new(&dest_dir), &label))
        } else {
            PathBuf::new()
        };
        let row = BtTaskRow {
            info_hash: actual_hash,
            label,
            dest_dir,
            mode: "download".into(),
            pinned: false,
            created_at: crate::storage::now_ms(),
            work_dir: work_dir.to_string_lossy().into_owned(),
            file_indices,
            package_mode: package_mode.into(),
            status: "active".into(),
            output_path: (package_mode == "archive")
                .then(|| output_path.to_string_lossy().into_owned()),
            total_bytes: Some(total),
            last_error: None,
        };
        self.storage.upsert_bt_task(&row)?;
        // Both modes need a watcher: the archive job packs on completion, the
        // plain download moves its finished file into the user's folder.
        self.start_finalize_job(&session, row.clone(), handle);
        Ok(self.task_info_with_live(row))
    }

    fn staging_root(&self) -> AppResult<PathBuf> {
        let root = self.base_dir()?.join("staging");
        std::fs::create_dir_all(&root)
            .map_err(|error| AppError(format!("创建 BT 暂存目录失败: {error}")))?;
        Ok(root)
    }

    pub(super) fn staging_dir_for(&self, info_hash: &str) -> AppResult<PathBuf> {
        parse_info_hash(info_hash)?;
        Ok(self.staging_root()?.join(info_hash))
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
                .map_err(|error| AppError(format!("更新文件选择失败: {error:#}")))?;
        }
        Ok(())
    }

    async fn replace_existing_task(
        &self,
        session: &Arc<Session>,
        info_hash: &str,
    ) -> AppResult<()> {
        self.cancel_finalize_job(info_hash);
        self.wait_for_finalize_job(info_hash).await?;
        let row = self.storage.get_bt_task(info_hash)?;
        let hash = parse_info_hash(info_hash)?;
        if find_handle(session, &hash)?.is_some() {
            let delete_files = row
                .as_ref()
                .is_some_and(|item| item.mode == "preview" || item.package_mode == "archive");
            session
                .delete(hash.into(), delete_files)
                .await
                .map_err(|error| AppError(format!("替换旧任务失败: {error:#}")))?;
        }
        if let Some(row) = row.as_ref() {
            self.remove_owned_task_dir(row)?;
        }
        self.storage.delete_bt_task(info_hash)?;
        self.storage.delete_bt_access(info_hash)?;
        Ok(())
    }

    /// Arm the watcher that turns a finished download into its published
    /// result. One job per task; a second call while one runs is a no-op.
    pub(super) fn start_finalize_job(
        &self,
        session: &Arc<Session>,
        row: BtTaskRow,
        handle: TorrentHandle,
    ) {
        let cancelled = Arc::new(AtomicBool::new(false));
        let inserted = self
            .finalize_jobs
            .lock()
            .map(|mut jobs| {
                if jobs.contains_key(&row.info_hash) {
                    false
                } else {
                    jobs.insert(row.info_hash.clone(), cancelled.clone());
                    true
                }
            })
            .unwrap_or(false);
        if !inserted {
            return;
        }
        let context = FinalizeContext {
            app: self.app.clone(),
            storage: self.storage.clone(),
            session: session.clone(),
            jobs: self.finalize_jobs.clone(),
            gate: self.finalize_gate.clone(),
            cancelled,
            row,
            handle,
        };
        tokio::spawn(async move { run_finalize_job(context).await });
    }

    pub(super) fn cancel_finalize_job(&self, info_hash: &str) {
        if let Ok(jobs) = self.finalize_jobs.lock() {
            if let Some(cancelled) = jobs.get(info_hash) {
                cancelled.store(true, Ordering::SeqCst);
            }
        }
    }

    pub(super) async fn wait_for_finalize_job(&self, info_hash: &str) -> AppResult<()> {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
        loop {
            let running = self
                .finalize_jobs
                .lock()
                .map(|jobs| jobs.contains_key(info_hash))
                .unwrap_or(false);
            if !running {
                return Ok(());
            }
            if tokio::time::Instant::now() >= deadline {
                return Err(AppError("取消打包超时，请稍后重试".into()));
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
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
        let Ok(rows) = self.storage.list_bt_direct_downloads() else {
            return;
        };
        for row in rows {
            let Ok(hash) = parse_info_hash(&row.info_hash) else {
                continue;
            };
            if let Ok(Some(handle)) = find_handle(session, &hash) {
                self.start_finalize_job(session, row, handle);
            }
        }
    }

    async fn resume_archive_jobs(&self, session: &Arc<Session>) {
        let Ok(rows) = self.storage.list_bt_archive_tasks() else {
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
                    let _ = session.delete(hash.into(), true).await;
                }
                let _ = self.remove_owned_task_dir(&row);
                continue;
            }
            if output_exists && row.status == "packaging" {
                if find_handle(session, &hash).ok().flatten().is_some() {
                    let _ = session.delete(hash.into(), true).await;
                }
                let _ = self.remove_owned_task_dir(&row);
                let _ = self.storage.update_bt_task_state(
                    &row.info_hash,
                    "completed",
                    row.output_path.as_deref(),
                    None,
                );
                super::cache::emit_event(&self.app, &row.info_hash, "package-completed");
                continue;
            }
            if let Ok(Some(handle)) = find_handle(session, &hash) {
                self.start_finalize_job(session, row, handle);
            } else {
                let _ = self.storage.update_bt_task_state(
                    &row.info_hash,
                    "error",
                    None,
                    Some("下载会话无法恢复，请重新添加任务"),
                );
            }
        }
    }

    pub(super) fn remove_owned_task_dir(&self, row: &BtTaskRow) -> AppResult<()> {
        if row.mode == "preview" {
            let root = self.cache_root()?;
            return remove_owned_hash_dir(&root, &root.join(&row.info_hash), &row.info_hash);
        }
        if row.package_mode == "archive" {
            return remove_owned_hash_dir(
                &self.staging_root()?,
                Path::new(&row.work_dir),
                &row.info_hash,
            );
        }
        if stages_into_part_dir(row) {
            return remove_part_dir(row);
        }
        Ok(())
    }

    pub(super) fn cleanup_orphan_owned_dirs(&self, session: &Session) {
        let mut referenced = HashSet::new();
        let mut roots: HashSet<PathBuf> = [self.cache_root(), self.staging_root()]
            .into_iter()
            .flatten()
            .collect();
        let mut part_roots = HashSet::new();
        if let Ok(rows) = self.storage.list_bt_tasks() {
            for row in rows {
                if row.mode == "preview" {
                    if let Ok(root) = self.cache_root() {
                        referenced.insert(root.join(row.info_hash));
                    }
                } else if row.package_mode == "archive" {
                    referenced.insert(PathBuf::from(row.work_dir));
                } else if stages_into_part_dir(&row) {
                    // Part dirs sit in the user's own folder, so the only way
                    // to learn their root is from the rows that use it.
                    part_roots.insert(part_root(Path::new(&row.dest_dir)));
                    // A finished or cancelled row has already handed its file
                    // over; anything still on disk there is leftover bulk.
                    if !matches!(row.status.as_str(), "completed" | "cancelled") {
                        referenced.insert(PathBuf::from(row.work_dir));
                    }
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
        roots.extend(part_roots.iter().cloned());
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
        for root in part_roots {
            let _ = std::fs::remove_dir(root);
        }
    }
}
fn validate_selection(handle: &TorrentHandle, file_indices: &[usize]) -> AppResult<u64> {
    let selected: HashSet<usize> = file_indices.iter().copied().collect();
    if selected.len() != file_indices.len() {
        return Err(AppError("文件选择包含重复项".into()));
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
        .map_err(|error| AppError(format!("读取资源信息失败: {error:#}")))?;
    if valid != selected.len() {
        return Err(AppError("文件选择包含无效或填充文件".into()));
    }
    Ok(total)
}
