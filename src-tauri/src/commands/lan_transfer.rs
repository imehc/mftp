use crate::error::AppResult;
use crate::lan_transfer;
use crate::models::{
    ActivityLog, LanAuthRequest, LanConnectedDevice, LanDiscoveredDevice, LanNetworkAddress,
    LanSharedDir, LanSharedDirInput, LanTransferSettings, LanTransferStatus, LanTransferTask,
    LanTrustedDevice, LanTrustedDeviceInput,
};
use crate::AppState;
use std::net::IpAddr;
use tauri::State;

#[tauri::command]
#[specta::specta]
pub fn lan_transfer_settings(state: State<AppState>) -> AppResult<LanTransferSettings> {
    state.storage.lan_transfer_settings()
}

#[tauri::command]
#[specta::specta]
pub fn lan_transfer_save_settings(
    state: State<AppState>,
    settings: LanTransferSettings,
) -> AppResult<LanTransferSettings> {
    state.storage.save_lan_transfer_settings(settings)
}

#[tauri::command]
#[specta::specta]
pub fn lan_transfer_status(state: State<AppState>) -> AppResult<LanTransferStatus> {
    Ok(state.lan_transfer.status())
}

#[tauri::command]
#[specta::specta]
pub fn lan_transfer_network_addresses() -> AppResult<Vec<LanNetworkAddress>> {
    Ok(lan_transfer::network_addresses())
}

#[tauri::command]
#[specta::specta]
pub fn lan_transfer_discover_devices(
    state: State<AppState>,
) -> AppResult<Vec<LanDiscoveredDevice>> {
    Ok(state.lan_transfer.discover_devices())
}

#[tauri::command]
#[specta::specta]
pub fn lan_transfer_connected_devices(
    state: State<AppState>,
) -> AppResult<Vec<LanConnectedDevice>> {
    Ok(state.lan_transfer.list_devices())
}

#[tauri::command]
#[specta::specta]
pub fn lan_transfer_pending_auth_requests(
    state: State<AppState>,
) -> AppResult<Vec<LanAuthRequest>> {
    Ok(state.lan_transfer.pending_auth_requests())
}

#[tauri::command]
#[specta::specta]
pub fn lan_transfer_approve_auth_request(
    state: State<AppState>,
    id: String,
    permission: String,
) -> AppResult<bool> {
    Ok(state.lan_transfer.approve_auth_request(&id, &permission))
}

#[tauri::command]
#[specta::specta]
pub fn lan_transfer_reject_auth_request(state: State<AppState>, id: String) -> AppResult<bool> {
    Ok(state.lan_transfer.reject_auth_request(&id))
}

#[tauri::command]
#[specta::specta]
pub fn lan_transfer_disconnect_device(state: State<AppState>, id: String) -> AppResult<()> {
    state.lan_transfer.disconnect_device(&id);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn lan_transfer_tasks(state: State<AppState>) -> AppResult<Vec<LanTransferTask>> {
    Ok(state.lan_transfer.list_tasks())
}

#[tauri::command]
#[specta::specta]
pub fn lan_transfer_cancel_task(state: State<AppState>, id: String) -> AppResult<()> {
    state.lan_transfer.cancel_task(&id);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn lan_transfer_start(state: State<AppState>) -> AppResult<LanTransferStatus> {
    let settings = state.storage.lan_transfer_settings()?;
    let shares = state.storage.list_lan_shared_dirs()?;
    let trusted_ips = state
        .storage
        .list_lan_trusted_devices()?
        .into_iter()
        .map(|device| device.ip)
        .collect();
    state.lan_transfer.start(
        settings,
        shares,
        trusted_ips,
        state.storage.db_path().to_path_buf(),
    )
}

#[tauri::command]
#[specta::specta]
pub fn lan_transfer_stop(state: State<AppState>) -> AppResult<LanTransferStatus> {
    state.lan_transfer.stop();
    Ok(state.lan_transfer.status())
}

#[tauri::command]
#[specta::specta]
pub fn lan_transfer_shared_dirs(state: State<AppState>) -> AppResult<Vec<LanSharedDir>> {
    state.storage.list_lan_shared_dirs()
}

#[tauri::command]
#[specta::specta]
pub fn lan_transfer_add_shared_dir(
    state: State<AppState>,
    input: LanSharedDirInput,
) -> AppResult<LanSharedDir> {
    state.storage.add_lan_shared_dir(input)
}

#[tauri::command]
#[specta::specta]
pub fn lan_transfer_delete_shared_dir(state: State<AppState>, id: String) -> AppResult<()> {
    state.storage.delete_lan_shared_dir(&id)
}

#[tauri::command]
#[specta::specta]
pub fn lan_transfer_trusted_devices(state: State<AppState>) -> AppResult<Vec<LanTrustedDevice>> {
    state.storage.list_lan_trusted_devices()
}

#[tauri::command]
#[specta::specta]
pub fn lan_transfer_add_trusted_device(
    state: State<AppState>,
    input: LanTrustedDeviceInput,
) -> AppResult<LanTrustedDevice> {
    input
        .ip
        .parse::<IpAddr>()
        .map_err(|_| crate::error::AppError(format!("无效的 IP 地址：{}", input.ip)))?;
    state.storage.add_lan_trusted_device(input)
}

#[tauri::command]
#[specta::specta]
pub fn lan_transfer_delete_trusted_device(state: State<AppState>, id: String) -> AppResult<()> {
    state.storage.delete_lan_trusted_device(&id)
}

#[tauri::command]
#[specta::specta]
pub fn activity_logs(state: State<AppState>, limit: Option<u32>) -> AppResult<Vec<ActivityLog>> {
    state.storage.list_activity_logs(limit.unwrap_or(500))
}

#[tauri::command]
#[specta::specta]
pub fn activity_logs_clear(state: State<AppState>) -> AppResult<()> {
    state.storage.clear_activity_logs()
}

#[tauri::command]
#[specta::specta]
pub fn activity_log_delete(state: State<AppState>, id: String) -> AppResult<()> {
    state.storage.delete_activity_log(&id)
}
