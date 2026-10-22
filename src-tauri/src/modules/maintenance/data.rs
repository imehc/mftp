use crate::app::services::AppServices;
use crate::error::AppResult;
use crate::models::{AppDataClearResult, AppDataModule, AppDataResetResult, AppDataUsage};
use std::sync::Arc;
use tauri::State;

use crate::core::execution::run_blocking;

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
        #[cfg(desktop)]
        AppDataModule::ActivityLogs => &[participants::LAN_TRANSFER],
        #[cfg(mobile)]
        AppDataModule::ActivityLogs => &[],
        AppDataModule::TranslationModels => &[participants::TRANSLATION],
        // A live download engine keeps file handles inside the data directory;
        // clearing while it runs would race the detach below.
        #[cfg(any(desktop, target_os = "android"))]
        AppDataModule::Downloads => &[participants::BT],
        #[cfg(not(any(desktop, target_os = "android")))]
        AppDataModule::Downloads => &[],
        #[cfg(desktop)]
        AppDataModule::Todo => &[participants::MCP],
        #[cfg(mobile)]
        AppDataModule::Todo => &[],
        AppDataModule::Vault | AppDataModule::Cache => &[],
    }
}

// The frontend localizes this stable key; the backend must not ship display copy.
pub(super) const PRESERVED_USER_FILES: &str = "bt-downloads-and-lan-shared-files";

#[tauri::command]
#[specta::specta]
pub async fn app_data_usage(state: State<'_, AppServices>) -> AppResult<AppDataUsage> {
    let storage = state.storage.clone();
    state
        .executor
        .blocking_unlogged(move || storage.app_data_usage())
        .await
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
    let storage = state.storage.clone();
    let result = match module {
        AppDataModule::Vault
        | AppDataModule::Hosts
        | AppDataModule::Todo
        | AppDataModule::ActivityLogs => {
            run_blocking(move || {
                let _maintenance = maintenance;
                let _ssh_maintenance = ssh_maintenance;
                let before = storage.app_data_usage();
                let count = storage.clear_data_module(module)?;
                Ok(storage.data_clear_result(module, count, before, Vec::new()))
            })
            .await?
        }
        AppDataModule::TranslationModels => {
            let translation = state.translation.clone();
            run_blocking(move || {
                let _maintenance = maintenance;
                let _ssh_maintenance = ssh_maintenance;
                let before = storage.app_data_usage();
                translation.clear()?;
                Ok(storage.data_clear_result(
                    AppDataModule::TranslationModels,
                    0,
                    before,
                    Vec::new(),
                ))
            })
            .await?
        }
        AppDataModule::Downloads => {
            run_blocking(move || {
                let _maintenance = maintenance;
                let _ssh_maintenance = ssh_maintenance;
                let before = storage.app_data_usage();
                storage.remove_bt_internal_data()?;
                Ok(storage.data_clear_result(AppDataModule::Downloads, 0, before, Vec::new()))
            })
            .await?
        }
        AppDataModule::Cache => {
            run_blocking(move || {
                let _maintenance = maintenance;
                let _ssh_maintenance = ssh_maintenance;
                let before = storage.app_data_usage();
                let count = storage.clear_cache()?;
                Ok(storage.data_clear_result(AppDataModule::Cache, count, before, Vec::new()))
            })
            .await?
        }
        AppDataModule::Poetry => {
            let storage = state.storage.clone();
            let poetry = state.poetry.clone();
            run_blocking(move || {
                let _maintenance = maintenance;
                let _ssh_maintenance = ssh_maintenance;
                let before = storage.app_data_usage();
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
    let maintenance = Arc::new(state.executor.maintenance().await?);
    super::reset::run_owned(state.inner().clone(), maintenance, None).await
}

#[cfg(test)]
#[path = "data_tests.rs"]
mod tests;
