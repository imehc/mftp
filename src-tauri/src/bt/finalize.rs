//! The post-download stage: wait for the pieces to land, then publish the
//! selected file or archive inside the application's private BT directory.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use librqbit::TorrentStatsState;
use tauri::Emitter as _;

use super::export::{
    archive_target, pack_tar, partial_archive_path, remove_file_if_exists, selected_export_files,
};
use super::TorrentHandle;
use crate::error::{AppError, AppResult};
use crate::storage::bt::BtTaskRow;
use crate::transfer::emit_transfer_progress_with_finish;

pub(super) fn emit_event(app: &tauri::AppHandle, info_hash: &str, kind: &str) {
    let _ = app.emit(
        crate::transfer::BT_TASK_EVENT,
        super::BtTaskEvent {
            info_hash: info_hash.to_string(),
            kind: kind.to_string(),
        },
    );
}

const ARCHIVE_PHASE: &str = "bt:packaging";
const DOWNLOAD_PHASE: &str = "bt:downloading";
/// Everything a publication job needs. Fields are `pub(super)` because the
/// job is assembled where the download is queued, in `download`.
pub(super) struct FinalizeContext {
    pub(super) app: tauri::AppHandle,
    pub(super) storage: crate::storage::Storage,
    pub(super) jobs: Arc<Mutex<std::collections::HashMap<String, Arc<AtomicBool>>>>,
    pub(super) gate: Arc<tokio::sync::Mutex<()>>,
    pub(super) cancelled: Arc<AtomicBool>,
    pub(super) row: BtTaskRow,
    pub(super) handle: TorrentHandle,
}

pub(super) async fn run_finalize_job(context: FinalizeContext) {
    let archive = context.row.package_mode == "archive";
    let result = if archive {
        finalize_archive(&context).await
    } else {
        finalize_direct(&context).await
    };
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
        // Archives have a dedicated event because packaging happens long after
        // the download; a plain download reports through its row status, which
        // the task list is already polling.
        if archive {
            emit_event(
                &context.app,
                &context.row.info_hash,
                &format!("package-failed:{message}"),
            );
        }
    }
}

/// Wait until every selected piece is on disk. Neither finalize path may touch
/// the files before this returns.
async fn wait_until_finished(handle: &TorrentHandle, cancelled: &AtomicBool) -> AppResult<()> {
    loop {
        if cancelled.load(Ordering::SeqCst) {
            return Err(AppError("任务已取消".into()));
        }
        let stats = handle.stats();
        if matches!(stats.state, TorrentStatsState::Error) {
            return Err(AppError(
                stats.error.unwrap_or_else(|| "BT 下载失败".into()),
            ));
        }
        if stats.finished || (stats.total_bytes > 0 && stats.progress_bytes >= stats.total_bytes) {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

/// Record the finished file in the private download directory. Exporting it to
/// a user-selected folder is a separate explicit operation.
async fn finalize_direct(context: &FinalizeContext) -> AppResult<()> {
    wait_until_finished(&context.handle, &context.cancelled).await?;
    let id = format!("bt:{}", context.row.info_hash);
    let total = context
        .row
        .total_bytes
        .unwrap_or_else(|| context.handle.stats().total_bytes);
    let finish = |storage_result: AppResult<()>| -> AppResult<()> {
        storage_result?;
        emit_transfer_progress_with_finish(
            &context.app,
            &id,
            DOWNLOAD_PHASE,
            total,
            Some(total),
            true,
        );
        Ok(())
    };
    let _guard = context.gate.lock().await;
    if context.cancelled.load(Ordering::SeqCst)
        || context
            .storage
            .get_bt_task(&context.row.info_hash)?
            .is_none()
    {
        return Err(AppError("任务已取消".into()));
    }
    // Metadata is only readable while the torrent is in the session, so resolve
    // the paths before dropping it.
    let files = selected_export_files(&context.handle, &context.row.file_indices)?;
    let output = files
        .first()
        .map(|file| file.absolute.to_string_lossy().into_owned());
    finish(context.storage.mark_bt_task_completed(
        &context.row.info_hash,
        (total > 0).then_some(total),
        output.as_deref(),
    ))
}

async fn finalize_archive(context: &FinalizeContext) -> AppResult<()> {
    wait_until_finished(&context.handle, &context.cancelled).await?;

    let target = context
        .row
        .output_path
        .as_ref()
        .map(PathBuf::from)
        .unwrap_or_else(|| archive_target(Path::new(&context.row.work_dir), &context.row.label));
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
    emit_transfer_progress_with_finish(
        &context.app,
        &format!("bt:{}", context.row.info_hash),
        ARCHIVE_PHASE,
        total,
        Some(total),
        true,
    );
    emit_event(&context.app, &context.row.info_hash, "package-completed");
    Ok(())
}
