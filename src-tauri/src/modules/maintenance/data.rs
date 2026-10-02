use crate::app::services::AppServices;
use crate::error::AppResult;
use crate::models::{AppDataClearResult, AppDataModule, AppDataResetResult, AppDataUsage};
use std::sync::Arc;
use tauri::State;

use crate::core::execution::{run_blocking, run_blocking_guarded};

use super::participants;

/// Module → participants with live domain work outside the drained Executor
/// lease. The busy capability itself is registered once with Lifecycle at
/// service construction (`app/services.rs`), so this table names ids only.
fn participants_for(module: AppDataModule) -> &'static [&'static str] {
    match module {
        AppDataModule::Hosts => &[participants::SSH],
        AppDataModule::Poetry => &[participants::POETRY],
        // The LAN HTTP hot path appends `activity_logs` directly without an
        // operation lease (by design, see the error-handling plan), so a
        // running server could keep writing rows while they are cleared.
        // Every other log writer leases through the drained Executor.
        AppDataModule::ActivityLogs => &[participants::LAN_TRANSFER],
        AppDataModule::Vault | AppDataModule::Todo => &[],
    }
}

// The frontend localizes this stable key; the backend must not ship display copy.
const PRESERVED_USER_FILES: &str = "bt-downloads-and-lan-shared-files";

#[tauri::command]
#[specta::specta]
pub fn app_data_usage(state: State<AppServices>) -> AppResult<AppDataUsage> {
    Ok(state.storage.app_data_usage())
}

#[tauri::command]
#[specta::specta]
pub async fn app_data_clear(
    state: State<'_, AppServices>,
    module: AppDataModule,
) -> AppResult<AppDataClearResult> {
    let maintenance = state.executor.maintenance().await?;
    let ssh_maintenance = state.manager.maintenance().await?;
    state.lifecycle.ensure_no_busy(participants_for(module))?;
    let before = state.storage.app_data_usage().total_bytes;
    let storage = state.storage.clone();
    let result = match module {
        AppDataModule::Vault
        | AppDataModule::Hosts
        | AppDataModule::Todo
        | AppDataModule::ActivityLogs => {
            run_blocking(move || {
                let _maintenance = maintenance;
                let _ssh_maintenance = ssh_maintenance;
                let count = storage.clear_data_module(module)?;
                Ok(storage.data_clear_result(module, count, before, Vec::new()))
            })
            .await?
        }
        AppDataModule::Poetry => {
            let storage = state.storage.clone();
            let poetry = state.poetry.clone();
            run_blocking(move || {
                let _maintenance = maintenance;
                let _ssh_maintenance = ssh_maintenance;
                poetry.delete_database()?;
                Ok(storage.data_clear_result(AppDataModule::Poetry, 0, before, Vec::new()))
            })
            .await?
        }
    };
    Ok(result)
}

#[tauri::command]
#[specta::specta]
pub async fn app_data_reset(state: State<'_, AppServices>) -> AppResult<AppDataResetResult> {
    // Drain the shared pipeline (including logs) before domain maintenance:
    // a pipeline operation may itself still need domain admission to finish.
    let maintenance = Arc::new(state.executor.maintenance().await?);
    let ssh_maintenance = Arc::new(state.manager.maintenance().await?);
    // Reset must wait for every registered participant; the list comes from
    // the same Lifecycle registration the exit path stops.
    let all_participants = state.lifecycle.participant_ids();
    state.lifecycle.ensure_no_busy(&all_participants)?;
    // BT runs locally on Android as well; iOS has no engine to stop.
    // Retain exclusive admission through the actual reset worker, not only its
    // async waiter. In-flight calls drain before checking the persisted state.
    #[cfg(any(desktop, target_os = "android"))]
    let bt_maintenance = state.bt.maintenance().await?;
    let before = state.storage.app_data_usage().total_bytes;
    // Reject failed SSH cleanup before stopping other domains or clearing AI
    // credentials. A cancelled waiter must still retain both maintenance gates.
    let ssh = state.manager.clone();
    run_blocking_guarded((maintenance.clone(), ssh_maintenance.clone()), move || {
        ssh.cleanup_local_temps()
    })
    .await?;
    #[cfg(any(desktop, target_os = "android"))]
    state.bt.stop_background_work().await;
    let storage = state.storage.clone();
    let cleanup_maintenance = maintenance.clone();
    let result = run_blocking(move || {
        let _maintenance = maintenance;
        let _ssh_maintenance = ssh_maintenance;
        #[cfg(any(desktop, target_os = "android"))]
        let _bt_maintenance = bt_maintenance;
        let records_deleted = storage.reset_database()?;
        storage.clear_poetry_database()?;
        // Detach before deleting; failure must not fall back to in-place
        // removal. This isolates open handles, not librqbit's path-based writes.
        storage.remove_bt_internal_data()?;
        Ok(AppDataResetResult {
            records_deleted,
            bytes_freed: before.saturating_sub(storage.app_data_usage().total_bytes),
            preserved: vec![PRESERVED_USER_FILES.into()],
        })
    })
    .await?;
    state
        .ai_configuration
        .cleanup_after_reset(cleanup_maintenance)
        .await?;
    Ok(result)
}

#[cfg(test)]
#[path = "data_tests.rs"]
mod tests;
