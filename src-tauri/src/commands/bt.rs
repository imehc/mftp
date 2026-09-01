//! BT IPC commands. UI entry points are desktop-only (route-level platform
//! guard); the lazily-started engine guarantees no network/disk side
//! effects even if a mobile build ever invoked them.

use crate::bt::{
    BtCacheItem, BtCacheStats, BtControlAction, BtPeerInfo, BtProbeResult, BtTaskInfo, BtTaskStats,
};
use crate::error::AppResult;
use crate::AppState;
use tauri::State;

#[tauri::command]
#[specta::specta]
pub async fn bt_probe(state: State<'_, AppState>, source: String) -> AppResult<BtProbeResult> {
    state.bt.probe(&source).await
}

#[tauri::command]
#[specta::specta]
pub async fn bt_add_download(
    state: State<'_, AppState>,
    source: String,
    info_hash: String,
    file_indices: Vec<usize>,
    dest_dir: String,
) -> AppResult<BtTaskInfo> {
    state
        .bt
        .add_download(&source, &info_hash, file_indices, dest_dir)
        .await
}

/// Ensure a streamable task exists for the target file (cache mode or an
/// existing task); returns the task info.
#[tauri::command]
#[specta::specta]
pub async fn bt_ensure_preview(
    state: State<'_, AppState>,
    source: String,
    file_index: usize,
) -> AppResult<BtTaskInfo> {
    state.bt.ensure_preview_task(&source, file_index).await
}

#[tauri::command]
#[specta::specta]
pub async fn bt_stream_url(
    state: State<'_, AppState>,
    info_hash: String,
    file_index: usize,
) -> AppResult<String> {
    state.bt.stream_url(&info_hash, file_index).await
}

#[tauri::command]
#[specta::specta]
pub async fn bt_list(state: State<'_, AppState>) -> AppResult<Vec<BtTaskInfo>> {
    state.bt.list().await
}

#[tauri::command]
#[specta::specta]
pub async fn bt_control(
    state: State<'_, AppState>,
    info_hash: String,
    action: BtControlAction,
    delete_files: bool,
) -> AppResult<()> {
    state.bt.control(&info_hash, action, delete_files).await
}

/// Save the file currently open in the preview page. Unfinished files are
/// exported automatically after their download completes.
#[tauri::command]
#[specta::specta]
pub async fn bt_save_to_local(
    state: State<'_, AppState>,
    info_hash: String,
    dest_dir: String,
    file_index: usize,
) -> AppResult<()> {
    state
        .bt
        .save_to_local(&info_hash, dest_dir, file_index)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn bt_cache_stats(state: State<'_, AppState>) -> AppResult<BtCacheStats> {
    Ok(BtCacheStats {
        used_bytes: state.bt.cache_used_bytes(),
        quota_bytes: state.bt.cache_quota_bytes(),
        items: state.bt.preview_task_count(),
    })
}

#[tauri::command]
#[specta::specta]
pub async fn bt_set_cache_quota(state: State<'_, AppState>, bytes: u64) -> AppResult<()> {
    state.bt.set_cache_quota(bytes)
}

#[tauri::command]
#[specta::specta]
pub async fn bt_clear_cache(state: State<'_, AppState>) -> AppResult<u32> {
    state.bt.clear_cache().await.map(|n| n as u32)
}

#[tauri::command]
#[specta::specta]
pub async fn bt_remove_cache(state: State<'_, AppState>, info_hash: String) -> AppResult<()> {
    state.bt.remove_cache(&info_hash).await
}

/// Cache-pool entries for the manageable cache list.
#[tauri::command]
#[specta::specta]
pub async fn bt_cache_items(state: State<'_, AppState>) -> AppResult<Vec<BtCacheItem>> {
    state.bt.cache_items().await
}

/// Live stats of one task (preview page footer polls this). `file_index`
/// narrows the byte counters to the previewed file.
#[tauri::command]
#[specta::specta]
pub async fn bt_task_stats(
    state: State<'_, AppState>,
    info_hash: String,
    file_index: Option<usize>,
) -> AppResult<BtTaskStats> {
    state.bt.task_stats(&info_hash, file_index)
}

#[tauri::command]
#[specta::specta]
pub async fn bt_task_peers(
    state: State<'_, AppState>,
    info_hash: String,
) -> AppResult<Vec<BtPeerInfo>> {
    state.bt.task_peers(&info_hash)
}
