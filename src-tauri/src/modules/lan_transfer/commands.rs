use crate::app::services::AppServices;
use crate::core::activity::OperationContext;
use crate::error::AppResult;
use std::net::IpAddr;
use tauri::State;

use super::{
    LanAuthRequest, LanConnectedDevice, LanDiscoveredDevice, LanNetworkAddress, LanSharedDir,
    LanSharedDirInput, LanTransferSettings, LanTransferStatus, LanTransferTask, LanTrustedDevice,
    LanTrustedDeviceInput,
};

#[tauri::command]
#[specta::specta]
pub async fn lan_transfer_settings(
    state: State<'_, AppServices>,
) -> AppResult<LanTransferSettings> {
    let repository = state.lan_repository.clone();
    state
        .executor
        .blocking_unlogged(move || repository.settings())
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn lan_transfer_save_settings(
    state: State<'_, AppServices>,
    settings: LanTransferSettings,
) -> AppResult<LanTransferSettings> {
    let repository = state.lan_repository.clone();
    state
        .executor
        .blocking(
            OperationContext::new("lan", "save_settings", ""),
            move || repository.save_settings(settings),
        )
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn lan_transfer_status(state: State<'_, AppServices>) -> AppResult<LanTransferStatus> {
    let manager = state.lan_transfer.clone();
    state
        .executor
        .blocking_unlogged(move || Ok(manager.status()))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn lan_transfer_network_addresses(
    state: State<'_, AppServices>,
) -> AppResult<Vec<LanNetworkAddress>> {
    state
        .executor
        .blocking_unlogged(|| Ok(super::network_addresses()))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn lan_transfer_discover_devices(
    state: State<'_, AppServices>,
) -> AppResult<Vec<LanDiscoveredDevice>> {
    let manager = state.lan_transfer.clone();
    state
        .executor
        .blocking_unlogged(move || manager.discover_devices())
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn lan_transfer_connected_devices(
    state: State<'_, AppServices>,
) -> AppResult<Vec<LanConnectedDevice>> {
    let manager = state.lan_transfer.clone();
    state
        .executor
        .blocking_unlogged(move || Ok(manager.list_devices()))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn lan_transfer_pending_auth_requests(
    state: State<'_, AppServices>,
) -> AppResult<Vec<LanAuthRequest>> {
    let manager = state.lan_transfer.clone();
    state
        .executor
        .blocking_unlogged(move || Ok(manager.pending_auth_requests()))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn lan_transfer_approve_auth_request(
    state: State<'_, AppServices>,
    id: String,
    permission: String,
) -> AppResult<bool> {
    let manager = state.lan_transfer.clone();
    let context =
        OperationContext::new("lan", "approve_auth", id.clone()).with_detail(permission.clone());
    state
        .executor
        .blocking(context, move || {
            Ok(manager.approve_auth_request(&id, &permission))
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn lan_transfer_reject_auth_request(
    state: State<'_, AppServices>,
    id: String,
) -> AppResult<bool> {
    let manager = state.lan_transfer.clone();
    state
        .executor
        .blocking(
            OperationContext::new("lan", "reject_auth", id.clone()),
            move || Ok(manager.reject_auth_request(&id)),
        )
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn lan_transfer_disconnect_device(
    state: State<'_, AppServices>,
    id: String,
) -> AppResult<()> {
    let manager = state.lan_transfer.clone();
    state
        .executor
        .blocking(
            OperationContext::new("lan", "disconnect_device", id.clone()),
            move || {
                manager.disconnect_device(&id);
                Ok(())
            },
        )
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn lan_transfer_tasks(state: State<'_, AppServices>) -> AppResult<Vec<LanTransferTask>> {
    let manager = state.lan_transfer.clone();
    state
        .executor
        .blocking_unlogged(move || Ok(manager.list_tasks()))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn lan_transfer_cancel_task(state: State<'_, AppServices>, id: String) -> AppResult<()> {
    let manager = state.lan_transfer.clone();
    state
        .executor
        .blocking(
            OperationContext::new("lan", "cancel_task", id.clone()),
            move || {
                manager.cancel_task(&id);
                Ok(())
            },
        )
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn lan_transfer_start(state: State<'_, AppServices>) -> AppResult<LanTransferStatus> {
    let manager = state.lan_transfer.clone();
    let repository = state.lan_repository.clone();
    let db_path = state.storage.db_path().to_path_buf();
    state
        .executor
        .blocking(OperationContext::new("lan", "start", ""), move || {
            let settings = repository.settings()?;
            let shares = repository.shared_dirs()?;
            let trusted_ips = repository
                .trusted_devices()?
                .into_iter()
                .map(|device| device.ip)
                .collect();
            manager.start(settings, shares, trusted_ips, db_path)
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn lan_transfer_stop(state: State<'_, AppServices>) -> AppResult<LanTransferStatus> {
    let manager = state.lan_transfer.clone();
    state
        .executor
        .blocking(OperationContext::new("lan", "stop", ""), move || {
            manager.stop();
            Ok(manager.status())
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn lan_transfer_shared_dirs(
    state: State<'_, AppServices>,
) -> AppResult<Vec<LanSharedDir>> {
    let repository = state.lan_repository.clone();
    state
        .executor
        .blocking_unlogged(move || repository.shared_dirs())
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn lan_transfer_add_shared_dir(
    state: State<'_, AppServices>,
    input: LanSharedDirInput,
) -> AppResult<LanSharedDir> {
    let repository = state.lan_repository.clone();
    state
        .executor
        .blocking(
            OperationContext::new("lan", "add_shared_dir", ""),
            move || repository.add_shared_dir(input),
        )
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn lan_transfer_delete_shared_dir(
    state: State<'_, AppServices>,
    id: String,
) -> AppResult<()> {
    let repository = state.lan_repository.clone();
    state
        .executor
        .blocking(
            OperationContext::new("lan", "delete_shared_dir", id.clone()),
            move || repository.delete_shared_dir(&id),
        )
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn lan_transfer_trusted_devices(
    state: State<'_, AppServices>,
) -> AppResult<Vec<LanTrustedDevice>> {
    let repository = state.lan_repository.clone();
    state
        .executor
        .blocking_unlogged(move || repository.trusted_devices())
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn lan_transfer_add_trusted_device(
    state: State<'_, AppServices>,
    input: LanTrustedDeviceInput,
) -> AppResult<LanTrustedDevice> {
    let repository = state.lan_repository.clone();
    state
        .executor
        .blocking(
            OperationContext::new("lan", "add_trusted_device", ""),
            move || {
                input.ip.parse::<IpAddr>().map_err(|_| {
                    crate::error::AppError::custom(crate::error::CustomErrorCode::LanIpInvalid)
                        .with_arg("ip", &input.ip)
                })?;
                repository.add_trusted_device(input)
            },
        )
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn lan_transfer_delete_trusted_device(
    state: State<'_, AppServices>,
    id: String,
) -> AppResult<()> {
    let repository = state.lan_repository.clone();
    state
        .executor
        .blocking(
            OperationContext::new("lan", "delete_trusted_device", id.clone()),
            move || repository.delete_trusted_device(&id),
        )
        .await
}
