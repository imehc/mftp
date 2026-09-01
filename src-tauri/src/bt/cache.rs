//! Cache pool management, safe task removal, and save-to-local orchestration.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use librqbit::{Session, TorrentStatsState};
use tauri::Emitter as _;
use walkdir::WalkDir;

use super::download::remove_owned_hash_dir;
use super::export::{
    export_files, export_files_are_complete, file_is_complete, partial_archive_path,
    remove_file_if_exists, selected_export_files, ExportFile,
};
use super::probe::handle_to_probe;
use super::{
    find_handle, is_completed_archive, parse_info_hash, same_dir, BtManager, TorrentHandle,
};
use crate::error::{AppError, AppResult};
use crate::storage::bt::BtTaskRow;

const META_QUOTA_KEY: &str = "bt_cache_quota";
const DEFAULT_CACHE_QUOTA: u64 = 5 * 1024 * 1024 * 1024;

pub type ActiveStreams = Arc<Mutex<HashMap<String, u32>>>;

impl BtManager {
    pub fn cache_quota_bytes(&self) -> u64 {
        self.storage
            .get_meta(META_QUOTA_KEY)
            .ok()
            .flatten()
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(DEFAULT_CACHE_QUOTA)
    }

    pub fn set_cache_quota(&self, bytes: u64) -> AppResult<()> {
        self.storage.set_meta(META_QUOTA_KEY, &bytes.to_string())
    }

    pub fn cache_used_bytes(&self) -> u64 {
        self.cache_root().map(|root| dir_size(&root)).unwrap_or(0)
    }

    /// Cache-pool entries. Starts the engine so each entry can carry its
    /// selected files (open / save-as in the cache list need the file index).
    pub async fn cache_items(&self) -> AppResult<Vec<super::BtCacheItem>> {
        let session = self.ensure_engine().await?;
        let mut items = Vec::new();
        for (hash, last_access) in self.storage.list_cache_lru()? {
            let Some(row) = self.storage.get_bt_task(&hash)? else {
                continue;
            };
            let size_bytes = self
                .cache_dir_for(&hash)?
                .map(|dir| dir_size(&dir))
                .unwrap_or(0);
            items.push(super::BtCacheItem {
                info_hash: hash.clone(),
                label: row.label,
                size_bytes,
                total_bytes: self.task_total_bytes(&hash),
                last_access,
                pinned: row.pinned,
                streaming: self.is_stream_active(&hash),
                files: self.selected_file_meta(&session, &hash, &row.file_indices),
            });
        }
        items.sort_by_key(|item| std::cmp::Reverse(item.last_access));
        Ok(items)
    }

    /// Metadata of a task's selected files. Empty when the engine has no
    /// handle (or metadata has not arrived), which the UI reads as "no file
    /// actions available yet" rather than an error.
    pub(super) fn selected_file_meta(
        &self,
        session: &Arc<Session>,
        info_hash: &str,
        file_indices: &[usize],
    ) -> Vec<super::BtFileMeta> {
        let Ok(hash) = parse_info_hash(info_hash) else {
            return Vec::new();
        };
        let Ok(Some(handle)) = find_handle(session, &hash) else {
            return Vec::new();
        };
        let Ok(probe) = handle_to_probe(&handle) else {
            return Vec::new();
        };
        probe
            .files
            .into_iter()
            .filter(|file| file_indices.contains(&file.index))
            .collect()
    }

    pub async fn clear_cache(&self) -> AppResult<usize> {
        let session = self.ensure_engine().await?;
        let mut removed = 0;
        for (hash, _) in self.storage.list_cache_lru()? {
            let Ok(Some(row)) = self.storage.get_bt_task(&hash) else {
                continue;
            };
            if row.pinned || self.is_stream_active(&hash) {
                continue;
            }
            if self.remove_preview_cache(&session, &hash).await.is_ok() {
                removed += 1;
            }
        }
        Ok(removed)
    }

    pub(super) async fn evict_if_needed(&self, exclude: &str) -> AppResult<()> {
        let Some(session) = self.engine_running() else {
            return Ok(());
        };
        for (hash, _) in self.storage.list_cache_lru()? {
            if self.cache_used_bytes() <= self.cache_quota_bytes() {
                break;
            }
            if hash == exclude {
                continue;
            }
            let Ok(Some(row)) = self.storage.get_bt_task(&hash) else {
                continue;
            };
            if row.pinned || self.is_stream_active(&hash) {
                continue;
            }
            let _ = self.remove_preview_cache(&session, &hash).await;
        }
        Ok(())
    }

    pub async fn remove_cache(&self, info_hash: &str) -> AppResult<()> {
        let session = self.ensure_engine().await?;
        // The media element closes its loopback HTTP request during route
        // teardown. Give that connection a short window to release its guard
        // before removing the preview torrent and owned cache directory.
        for _ in 0..20 {
            if !self.is_stream_active(info_hash) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        let row = self
            .storage
            .get_bt_task(info_hash)?
            .ok_or_else(|| AppError("缓存任务不存在".into()))?;
        if is_completed_archive(&row.status, &row.package_mode) {
            return self.remove_completed_archive_preview(&session, &row).await;
        }
        self.remove_preview_cache(&session, info_hash).await
    }

    async fn remove_completed_archive_preview(
        &self,
        session: &Arc<Session>,
        row: &BtTaskRow,
    ) -> AppResult<()> {
        let hash = parse_info_hash(&row.info_hash)?;
        let cache_root = self.cache_root()?;
        let cache_dir = cache_root.join(&row.info_hash);
        if let Some(handle) = find_handle(session, &hash)? {
            let owns_output = same_dir(handle.output_folder(), &cache_dir);
            session
                .delete(hash.into(), owns_output)
                .await
                .map_err(|error| AppError(format!("清理预览缓存失败: {error:#}")))?;
        }
        remove_owned_hash_dir(&cache_root, &cache_dir, &row.info_hash)
    }

    async fn remove_preview_cache(&self, session: &Arc<Session>, info_hash: &str) -> AppResult<()> {
        let row = self
            .storage
            .get_bt_task(info_hash)?
            .ok_or_else(|| AppError("缓存任务不存在".into()))?;
        if row.mode != "preview" {
            return Err(AppError("该任务不是在线预览缓存".into()));
        }
        if row.pinned || self.is_stream_active(info_hash) {
            return Err(AppError("缓存正在使用中".into()));
        }

        let hash = parse_info_hash(info_hash)?;
        let total_bytes = if let Some(handle) = find_handle(session, &hash)? {
            let total = handle.stats().total_bytes;
            session
                .delete(hash.into(), true)
                .await
                .map_err(|error| AppError(format!("清理预览缓存失败: {error:#}")))?;
            (total > 0).then_some(total)
        } else {
            row.total_bytes
        };
        self.remove_owned_task_dir(&row)?;
        self.storage.mark_bt_cache_cleared(info_hash, total_bytes)?;
        Ok(())
    }

    pub fn is_stream_active(&self, info_hash: &str) -> bool {
        stream_active(&self.active_streams, info_hash)
    }

    pub(super) async fn remove_task_data(
        &self,
        session: &Arc<Session>,
        info_hash: &str,
        delete_files: bool,
    ) -> AppResult<()> {
        self.remove_task_data_with_notify(session, info_hash, delete_files, true)
            .await
    }

    async fn remove_task_data_with_notify(
        &self,
        session: &Arc<Session>,
        info_hash: &str,
        delete_files: bool,
        notify: bool,
    ) -> AppResult<()> {
        let row = self.storage.get_bt_task(info_hash)?;
        self.cancel_finalize_job(info_hash);
        self.wait_for_finalize_job(info_hash).await?;
        let _gate = self.finalize_gate.lock().await;

        if let Ok(hash) = parse_info_hash(info_hash) {
            if find_handle(session, &hash)?.is_some() {
                let remove_engine_files = delete_files
                    || row.as_ref().is_some_and(|task| {
                        task.mode == "preview"
                            || task.package_mode == "archive"
                            || super::download::stages_into_part_dir(task)
                    });
                session
                    .delete(hash.into(), remove_engine_files)
                    .await
                    .map_err(|error| AppError(format!("删除 BT 会话失败: {error:#}")))?;
            }
        }

        if let Some(task) = row.as_ref() {
            if let Some(output) = task.output_path.as_deref() {
                let output = PathBuf::from(output);
                if let Ok(partial) = partial_archive_path(&output, info_hash) {
                    remove_file_if_exists(&partial)?;
                }
                if task.package_mode == "archive" && (delete_files || task.status == "packaging") {
                    remove_file_if_exists(&output)?;
                }
            }
            self.remove_owned_task_dir(task)?;
        }
        self.storage.delete_bt_access(info_hash)?;
        self.storage.delete_bt_task(info_hash)?;
        if notify {
            emit_event(&self.app, info_hash, "removed");
        }
        Ok(())
    }

    pub(super) fn cache_dir_for(&self, info_hash: &str) -> AppResult<Option<PathBuf>> {
        let Some(row) = self.storage.get_bt_task(info_hash)? else {
            return Ok(None);
        };
        if row.mode != "preview" {
            return Ok(None);
        }
        Ok(Some(self.cache_root()?.join(info_hash)))
    }

    pub async fn save_to_local(
        &self,
        info_hash: &str,
        dest_dir: String,
        file_index: usize,
    ) -> AppResult<()> {
        let row = self
            .storage
            .get_bt_task(info_hash)?
            .ok_or_else(|| AppError("任务不存在".into()))?;
        if dest_dir.trim().is_empty() {
            return Err(AppError("目标目录不能为空".into()));
        }
        let destination = PathBuf::from(dest_dir);
        let create_destination = destination.clone();
        tokio::task::spawn_blocking(move || std::fs::create_dir_all(create_destination))
            .await
            .map_err(|error| AppError(format!("创建目标目录任务失败: {error}")))?
            .map_err(|error| AppError(format!("创建目标目录失败: {error}")))?;

        let session = self.ensure_engine().await?;
        let hash = parse_info_hash(info_hash)?;
        let handle = find_handle(&session, &hash)?
            .ok_or_else(|| AppError("任务不存在或尚未初始化".into()))?;
        let files = selected_export_files(&handle, &[file_index])?;
        let ready = file_is_complete(&handle, file_index)?;
        if ready {
            export_ready_files(files, destination, row.label.clone(), info_hash.to_string())
                .await?;
            self.finish_preview_export(&session, &row).await?;
            emit_event(&self.app, info_hash, "saved");
            return Ok(());
        }

        self.storage.set_bt_pinned(info_hash, true)?;
        let inserted = self
            .pending_saves
            .lock()
            .map(|mut pending| pending.insert(info_hash.to_string()))
            .unwrap_or(false);
        if !inserted {
            return Err(AppError("该任务已有转存在进行中".into()));
        }
        let context = PendingSaveContext {
            app: self.app.clone(),
            storage: self.storage.clone(),
            session,
            pending: self.pending_saves.clone(),
            streams: self.active_streams.clone(),
            cache_root: self.cache_root()?,
            row,
            handle,
            files,
            destination,
        };
        tokio::spawn(async move { run_pending_save(context).await });
        Ok(())
    }

    async fn finish_preview_export(
        &self,
        session: &Arc<Session>,
        row: &BtTaskRow,
    ) -> AppResult<()> {
        if row.mode != "preview" || self.is_stream_active(&row.info_hash) {
            self.storage.set_bt_pinned(&row.info_hash, false)?;
            return Ok(());
        }
        self.remove_task_data_with_notify(session, &row.info_hash, true, false)
            .await
    }
}

struct PendingSaveContext {
    app: tauri::AppHandle,
    storage: crate::storage::Storage,
    session: Arc<Session>,
    pending: Arc<Mutex<std::collections::HashSet<String>>>,
    streams: ActiveStreams,
    cache_root: PathBuf,
    row: BtTaskRow,
    handle: TorrentHandle,
    files: Vec<ExportFile>,
    destination: PathBuf,
}

async fn run_pending_save(context: PendingSaveContext) {
    let result = match wait_for_files(&context).await {
        Ok(()) => {
            export_ready_files(
                context.files.clone(),
                context.destination.clone(),
                context.row.label.clone(),
                context.row.info_hash.clone(),
            )
            .await
        }
        Err(error) => Err(error),
    };
    if let Ok(mut pending) = context.pending.lock() {
        pending.remove(&context.row.info_hash);
    }
    match result {
        Ok(_) => match cleanup_saved_preview(&context).await {
            Ok(()) => emit_event(&context.app, &context.row.info_hash, "saved"),
            Err(error) => {
                let _ = context.storage.set_bt_pinned(&context.row.info_hash, false);
                emit_event(
                    &context.app,
                    &context.row.info_hash,
                    &format!("save-failed:{error}"),
                );
            }
        },
        Err(error) => {
            let _ = context.storage.set_bt_pinned(&context.row.info_hash, false);
            emit_event(
                &context.app,
                &context.row.info_hash,
                &format!("save-failed:{error}"),
            );
        }
    }
}

async fn wait_for_files(context: &PendingSaveContext) -> AppResult<()> {
    loop {
        if context
            .storage
            .get_bt_task(&context.row.info_hash)?
            .is_none()
        {
            return Err(AppError("任务已取消或删除".into()));
        }
        let stats = context.handle.stats();
        if matches!(stats.state, TorrentStatsState::Error) {
            return Err(AppError(
                stats.error.unwrap_or_else(|| "BT 下载失败".into()),
            ));
        }
        if export_files_are_complete(&context.handle, &context.files) {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

async fn export_ready_files(
    files: Vec<ExportFile>,
    destination: PathBuf,
    label: String,
    info_hash: String,
) -> AppResult<PathBuf> {
    tokio::task::spawn_blocking(move || {
        export_files(
            &files,
            &destination,
            &label,
            &info_hash,
            &AtomicBool::new(false),
        )
    })
    .await
    .map_err(|error| AppError(format!("转存任务异常终止: {error}")))?
}

async fn cleanup_saved_preview(context: &PendingSaveContext) -> AppResult<()> {
    if context.row.mode != "preview" || stream_active(&context.streams, &context.row.info_hash) {
        return context.storage.set_bt_pinned(&context.row.info_hash, false);
    }
    let hash = parse_info_hash(&context.row.info_hash)?;
    if find_handle(&context.session, &hash)?.is_some() {
        context
            .session
            .delete(hash.into(), true)
            .await
            .map_err(|error| AppError(format!("清理预览缓存失败: {error:#}")))?;
    }
    remove_owned_hash_dir(
        &context.cache_root,
        Path::new(&context.row.work_dir),
        &context.row.info_hash,
    )?;
    context.storage.delete_bt_access(&context.row.info_hash)?;
    context.storage.delete_bt_task(&context.row.info_hash)
}

fn stream_active(streams: &ActiveStreams, info_hash: &str) -> bool {
    streams
        .lock()
        .map(|map| map.get(info_hash).copied().unwrap_or(0) > 0)
        .unwrap_or(false)
}

pub(super) fn emit_event(app: &tauri::AppHandle, info_hash: &str, kind: &str) {
    let _ = app.emit(
        crate::transfer::BT_TASK_EVENT,
        super::BtTaskEvent {
            info_hash: info_hash.to_string(),
            kind: kind.to_string(),
        },
    );
}

fn dir_size(root: &Path) -> u64 {
    WalkDir::new(root)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
        .filter_map(|entry| entry.metadata().ok())
        .map(|metadata| metadata.len())
        .sum()
}
