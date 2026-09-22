//! BT IPC commands. Desktop and Android invoke the same local engine; iOS
//! does not register this module because librqbit's socket layer is not
//! available for that target yet.

use crate::bt::{
    BtControlAction, BtDhtStatus, BtPeerInfo, BtPlayability, BtProbeResult, BtTaskInfo,
};
use crate::error::AppResult;
use crate::AppState;
use tauri::State;

use super::record_operation;

#[tauri::command]
#[specta::specta]
pub async fn bt_browse_files(
    state: State<'_, AppState>,
    info_hash: String,
    path: Option<String>,
) -> AppResult<crate::bt::BtFileListing> {
    state.bt.browse_files(&info_hash, path).await
}

#[tauri::command]
#[specta::specta]
pub async fn bt_preview_file(
    state: State<'_, AppState>,
    info_hash: String,
    path: String,
) -> AppResult<crate::bt::BtFilePreview> {
    state.bt.preview_file(&info_hash, path).await
}

#[tauri::command]
#[specta::specta]
pub async fn bt_open_file(
    state: State<'_, AppState>,
    info_hash: String,
    path: String,
) -> AppResult<()> {
    state.bt.open_file(&info_hash, path).await
}

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
) -> AppResult<BtTaskInfo> {
    let result = state
        .bt
        .add_download(&source, &info_hash, file_indices)
        .await;
    record_operation(
        &state.storage,
        "bt",
        &info_hash,
        "add_download",
        None,
        &result,
    );
    result
}

#[tauri::command]
#[specta::specta]
pub async fn bt_export(
    state: State<'_, AppState>,
    info_hash: String,
    dest_dir: String,
) -> AppResult<BtTaskInfo> {
    let result = state.bt.export_task(&info_hash, dest_dir).await;
    record_operation(&state.storage, "bt", &info_hash, "export", None, &result);
    result
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
    let result = state.bt.control(&info_hash, action, delete_files).await;
    record_operation(&state.storage, "bt", &info_hash, "control", None, &result);
    result
}

#[tauri::command]
#[specta::specta]
pub async fn bt_task_peers(
    state: State<'_, AppState>,
    info_hash: String,
) -> AppResult<Vec<BtPeerInfo>> {
    state.bt.task_peers(&info_hash)
}

#[tauri::command]
#[specta::specta]
pub async fn bt_dht_status(state: State<'_, AppState>) -> AppResult<BtDhtStatus> {
    state.bt.dht_status().await
}

#[tauri::command]
#[specta::specta]
pub async fn bt_playability(
    state: State<'_, AppState>,
    info_hash: String,
    file_index: usize,
    prepare: bool,
) -> AppResult<BtPlayability> {
    state.bt.playability(&info_hash, file_index, prepare).await
}
