//! BT download setup and multi-file archive finalization.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use librqbit::{Session, TorrentStatsState};

use super::export::{
    archive_target, pack_tar, partial_archive_path, remove_file_if_exists, selected_export_files,
};
use super::{
    find_handle, info_hash_hex, parse_info_hash, same_dir, BtManager, BtTaskInfo, TorrentHandle,
};
use crate::error::{AppError, AppResult};
use crate::storage::bt::BtTaskRow;
use crate::transfer::emit_transfer_progress_with_finish;

const ARCHIVE_PHASE: &str = "bt:packaging";

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
        let work_dir = if package_mode == "archive" {
            self.staging_dir_for(&expected_info_hash)?
        } else {
            PathBuf::from(&dest_dir)
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
            let _ = session
                .delete(handle.info_hash().into(), package_mode == "archive")
                .await;
            return Err(AppError("资源标识与解析结果不一致".into()));
        }

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
        if package_mode == "archive" {
            self.start_archive_job(&session, row.clone(), handle);
        }
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
        self.cancel_archive_job(info_hash);
        self.wait_for_archive_job(info_hash).await?;
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

    pub(super) fn start_archive_job(
        &self,
        session: &Arc<Session>,
        row: BtTaskRow,
        handle: TorrentHandle,
    ) {
        let cancelled = Arc::new(AtomicBool::new(false));
        let inserted = self
            .archive_jobs
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
        let context = ArchiveContext {
            app: self.app.clone(),
            storage: self.storage.clone(),
            session: session.clone(),
            jobs: self.archive_jobs.clone(),
            gate: self.archive_gate.clone(),
            cancelled,
            row,
            handle,
        };
        tokio::spawn(async move { run_archive_job(context).await });
    }

    pub(super) fn cancel_archive_job(&self, info_hash: &str) {
        if let Ok(jobs) = self.archive_jobs.lock() {
            if let Some(cancelled) = jobs.get(info_hash) {
                cancelled.store(true, Ordering::SeqCst);
            }
        }
    }

    pub(super) async fn wait_for_archive_job(&self, info_hash: &str) -> AppResult<()> {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
        loop {
            let running = self
                .archive_jobs
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

    pub(super) async fn resume_archive_jobs(&self, session: &Arc<Session>) {
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
                self.start_archive_job(session, row, handle);
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
        let candidate = if row.mode == "preview" {
            self.cache_root()?.join(&row.info_hash)
        } else if row.package_mode == "archive" {
            PathBuf::from(&row.work_dir)
        } else {
            return Ok(());
        };
        let allowed_root = if row.mode == "preview" {
            self.cache_root()?
        } else {
            self.staging_root()?
        };
        remove_owned_hash_dir(&allowed_root, &candidate, &row.info_hash)
    }

    pub(super) fn cleanup_orphan_owned_dirs(&self, session: &Session) {
        let mut referenced = HashSet::new();
        if let Ok(rows) = self.storage.list_bt_tasks() {
            for row in rows {
                if row.mode == "preview" {
                    if let Ok(root) = self.cache_root() {
                        referenced.insert(root.join(row.info_hash));
                    }
                } else if row.package_mode == "archive" {
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
        for root in [self.cache_root(), self.staging_root()]
            .into_iter()
            .flatten()
        {
            let Ok(entries) = std::fs::read_dir(&root) else {
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

struct ArchiveContext {
    app: tauri::AppHandle,
    storage: crate::storage::Storage,
    session: Arc<Session>,
    jobs: Arc<Mutex<std::collections::HashMap<String, Arc<AtomicBool>>>>,
    gate: Arc<tokio::sync::Mutex<()>>,
    cancelled: Arc<AtomicBool>,
    row: BtTaskRow,
    handle: TorrentHandle,
}

async fn run_archive_job(context: ArchiveContext) {
    let result = finalize_archive(&context).await;
    if let Ok(mut jobs) = context.jobs.lock() {
        jobs.remove(&context.row.info_hash);
    }
    if context.cancelled.load(Ordering::SeqCst) {
        return;
    }
    if let Err(error) = result {
        let message = error.to_string();
        let _ = context.storage.update_bt_task_state(
            &context.row.info_hash,
            "error",
            None,
            Some(&message),
        );
        super::cache::emit_event(
            &context.app,
            &context.row.info_hash,
            &format!("package-failed:{message}"),
        );
    }
}

async fn finalize_archive(context: &ArchiveContext) -> AppResult<()> {
    loop {
        if context.cancelled.load(Ordering::SeqCst) {
            return Err(AppError("任务已取消".into()));
        }
        let stats = context.handle.stats();
        if matches!(stats.state, TorrentStatsState::Error) {
            return Err(AppError(
                stats.error.unwrap_or_else(|| "BT 下载失败".into()),
            ));
        }
        if stats.finished || (stats.total_bytes > 0 && stats.progress_bytes >= stats.total_bytes) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }

    let reserved_target = context
        .row
        .output_path
        .as_ref()
        .map(PathBuf::from)
        .ok_or_else(|| AppError("压缩包目标路径缺失".into()))?;
    let target = if reserved_target.exists()
        || !reserved_target
            .extension()
            .is_some_and(|extension| extension == "tar")
    {
        archive_target(Path::new(&context.row.dest_dir), &context.row.label)
    } else {
        reserved_target
    };
    context.storage.update_bt_task_state(
        &context.row.info_hash,
        "packaging",
        Some(&target.to_string_lossy()),
        None,
    )?;
    let total = context.row.total_bytes.unwrap_or(0);
    emit_transfer_progress_with_finish(
        &context.app,
        &format!("bt:{}", context.row.info_hash),
        ARCHIVE_PHASE,
        total,
        Some(total),
        false,
    );

    let files = selected_export_files(&context.handle, &context.row.file_indices)?;
    let partial = partial_archive_path(&target, &context.row.info_hash)?;
    remove_file_if_exists(&partial)?;
    let cancelled = context.cancelled.clone();
    let pack_result = tokio::task::spawn_blocking(move || {
        pack_tar(&files, &partial, &cancelled).map(|_| partial)
    })
    .await
    .map_err(|error| AppError(format!("打包任务异常终止: {error}")))?;
    let partial = match pack_result {
        Ok(path) => path,
        Err(error) => {
            if let Ok(path) = partial_archive_path(&target, &context.row.info_hash) {
                let _ = remove_file_if_exists(&path);
            }
            return Err(error);
        }
    };
    if context.cancelled.load(Ordering::SeqCst) {
        let _ = remove_file_if_exists(&partial);
        return Err(AppError("任务已取消".into()));
    }

    let _guard = context.gate.lock().await;
    if context.cancelled.load(Ordering::SeqCst)
        || context
            .storage
            .get_bt_task(&context.row.info_hash)?
            .is_none()
    {
        let _ = remove_file_if_exists(&partial);
        return Err(AppError("任务已取消".into()));
    }
    if target.exists() {
        let _ = remove_file_if_exists(&partial);
        return Err(AppError("压缩包目标文件已存在，请重试".into()));
    }
    std::fs::rename(&partial, &target)
        .map_err(|error| AppError(format!("保存压缩包失败: {error}")))?;
    context.storage.update_bt_task_state(
        &context.row.info_hash,
        "completed",
        Some(&target.to_string_lossy()),
        None,
    )?;
    let hash = parse_info_hash(&context.row.info_hash)?;
    if find_handle(&context.session, &hash)?.is_some() {
        let _ = context.session.delete(hash.into(), true).await;
    }
    emit_transfer_progress_with_finish(
        &context.app,
        &format!("bt:{}", context.row.info_hash),
        ARCHIVE_PHASE,
        total,
        Some(total),
        true,
    );
    super::cache::emit_event(&context.app, &context.row.info_hash, "package-completed");
    Ok(())
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

pub(super) fn remove_owned_hash_dir(
    root: &Path,
    candidate: &Path,
    info_hash: &str,
) -> AppResult<()> {
    if candidate.parent() != Some(root)
        || candidate.file_name().and_then(|name| name.to_str()) != Some(info_hash)
    {
        return Err(AppError("拒绝清理非 BT 自有目录".into()));
    }
    match std::fs::remove_dir_all(candidate) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(AppError(format!("清理 BT 暂存目录失败: {error}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("mftp-bt-path-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn owned_cleanup_removes_only_the_exact_hash_child() {
        let root = temp_dir("owned");
        let hash = "a".repeat(40);
        let owned = root.join(&hash);
        std::fs::create_dir_all(&owned).unwrap();
        remove_owned_hash_dir(&root, &owned, &hash).unwrap();
        assert!(!owned.exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn owned_cleanup_rejects_user_directories() {
        let root = temp_dir("root");
        let user = temp_dir("user");
        let sentinel = user.join("keep.txt");
        std::fs::write(&sentinel, b"keep").unwrap();
        let hash = "b".repeat(40);
        assert!(remove_owned_hash_dir(&root, &user, &hash).is_err());
        assert_eq!(std::fs::read(&sentinel).unwrap(), b"keep");
        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(user).unwrap();
    }
}
