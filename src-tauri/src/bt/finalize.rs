//! The post-download stage: wait for the pieces to land, then either rename a
//! single file into the user's folder or pack the selected files into one
//! archive.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use librqbit::{Session, TorrentStatsState};

use super::export::{
    archive_target, move_export_file, pack_tar, partial_archive_path, remove_file_if_exists,
    selected_export_files,
};
use super::staging::{remove_part_dir, stages_into_part_dir};
use super::{find_handle, parse_info_hash, TorrentHandle};
use crate::error::{AppError, AppResult};
use crate::storage::bt::BtTaskRow;
use crate::transfer::emit_transfer_progress_with_finish;

const ARCHIVE_PHASE: &str = "bt:packaging";
const DOWNLOAD_PHASE: &str = "bt:downloading";
/// Everything a publication job needs. Fields are `pub(super)` because the
/// job is assembled where the download is queued, in `download`.
pub(super) struct FinalizeContext {
    pub(super) app: tauri::AppHandle,
    pub(super) storage: crate::storage::Storage,
    pub(super) session: Arc<Session>,
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
            super::cache::emit_event(
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

/// Hand a finished single-file download over to the user's folder. Everything
/// before this point happened inside the hidden part dir, so this rename is the
/// moment the file becomes visible — and it is whole when it appears.
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
    if !stages_into_part_dir(&context.row) {
        // Row from before staging existed: the engine wrote straight into the
        // user's folder, so there is nothing left to hand over.
        return finish(context.storage.mark_bt_task_completed(
            &context.row.info_hash,
            (total > 0).then_some(total),
            None,
        ));
    }

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
    let hash = parse_info_hash(&context.row.info_hash)?;
    if find_handle(&context.session, &hash)?.is_some() {
        // Stop seeding before moving: the engine has the file open, and there
        // is nothing left to serve from a path we are about to empty.
        context
            .session
            .delete(hash.into(), false)
            .await
            .map_err(|error| AppError(format!("结束下载失败: {error:#}")))?;
    }
    let dest_dir = PathBuf::from(&context.row.dest_dir);
    let moved = tokio::task::spawn_blocking(move || {
        files
            .iter()
            .map(|file| move_export_file(file, &dest_dir))
            .collect::<AppResult<Vec<_>>>()
    })
    .await
    .map_err(|error| AppError(format!("转存任务异常终止: {error}")))??;
    let output = moved
        .first()
        .map(|path| path.to_string_lossy().into_owned());
    let _ = remove_part_dir(&context.row);
    finish(context.storage.mark_bt_task_completed(
        &context.row.info_hash,
        (total > 0).then_some(total),
        output.as_deref(),
    ))
}

async fn finalize_archive(context: &FinalizeContext) -> AppResult<()> {
    wait_until_finished(&context.handle, &context.cancelled).await?;

    let reserved_target = context
        .row
        .output_path
        .as_ref()
        .map(PathBuf::from)
        .ok_or_else(|| AppError("压缩包目标路径缺失".into()))?;
    let target = if reserved_target.exists()
        || reserved_target
            .extension()
            .is_none_or(|extension| extension != "tar")
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
