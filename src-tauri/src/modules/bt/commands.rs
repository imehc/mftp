//! BT IPC commands. Desktop and Android invoke the same local engine; iOS
//! does not register this module because librqbit's socket layer is not
//! available for that target yet.

use crate::app::services::AppServices;
use crate::error::AppResult;
use crate::modules::bt::{
    BtControlAction, BtDhtStatus, BtPeerInfo, BtPlayability, BtProbeResult, BtTaskInfo,
};
use tauri::State;

use crate::core::activity::OperationContext;

#[tauri::command]
#[specta::specta]
pub async fn bt_browse_files(
    state: State<'_, AppServices>,
    info_hash: String,
    path: Option<String>,
) -> AppResult<crate::modules::bt::BtFileListing> {
    state.bt.browse_files(&info_hash, path).await
}

#[tauri::command]
#[specta::specta]
pub async fn bt_preview_file(
    state: State<'_, AppServices>,
    info_hash: String,
    path: String,
) -> AppResult<crate::modules::bt::BtFilePreview> {
    state.bt.preview_file(&info_hash, path).await
}

#[tauri::command]
#[specta::specta]
pub async fn bt_open_file(
    state: State<'_, AppServices>,
    info_hash: String,
    path: String,
) -> AppResult<()> {
    state.bt.open_file(&info_hash, path).await
}

#[tauri::command]
#[specta::specta]
pub async fn bt_probe(state: State<'_, AppServices>, source: String) -> AppResult<BtProbeResult> {
    state.bt.probe(&source).await
}

#[tauri::command]
#[specta::specta]
pub async fn bt_add_download(
    state: State<'_, AppServices>,
    source: String,
    info_hash: String,
    file_indices: Vec<usize>,
) -> AppResult<BtTaskInfo> {
    state
        .executor
        .asynchronous(
            OperationContext::new("bt", "add_download", info_hash.clone()),
            state.bt.add_download(&source, &info_hash, file_indices),
        )
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn bt_export(
    state: State<'_, AppServices>,
    info_hash: String,
    dest_dir: String,
) -> AppResult<BtTaskInfo> {
    state
        .executor
        .asynchronous(
            OperationContext::new("bt", "export", info_hash.clone()),
            state.bt.export_task(&info_hash, dest_dir),
        )
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn bt_list(state: State<'_, AppServices>) -> AppResult<Vec<BtTaskInfo>> {
    state.bt.list().await
}

#[tauri::command]
#[specta::specta]
pub async fn bt_control(
    state: State<'_, AppServices>,
    info_hash: String,
    action: BtControlAction,
    delete_files: bool,
) -> AppResult<()> {
    state
        .executor
        .asynchronous(
            OperationContext::new("bt", "control", info_hash.clone()),
            state.bt.control(&info_hash, action, delete_files),
        )
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn bt_task_peers(
    state: State<'_, AppServices>,
    info_hash: String,
) -> AppResult<Vec<BtPeerInfo>> {
    state.bt.task_peers(&info_hash).await
}

#[tauri::command]
#[specta::specta]
pub async fn bt_dht_status(state: State<'_, AppServices>) -> AppResult<BtDhtStatus> {
    state.bt.dht_status().await
}

#[tauri::command]
#[specta::specta]
pub async fn bt_playability(
    state: State<'_, AppServices>,
    info_hash: String,
    file_index: usize,
    prepare: bool,
) -> AppResult<BtPlayability> {
    state.bt.playability(&info_hash, file_index, prepare).await
}
