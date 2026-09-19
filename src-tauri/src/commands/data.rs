use crate::error::{AppError, AppResult};
use crate::models::{AppDataClearResult, AppDataModule, AppDataResetResult, AppDataUsage};
use crate::AppState;
use std::fs;
use tauri::State;

use super::run_blocking;

fn ensure_idle(state: &AppState, module: AppDataModule) -> AppResult<()> {
    if matches!(module, AppDataModule::Hosts) && state.manager.is_busy() {
        return Err(AppError("请先断开 SSH/SFTP 连接并停止传输".into()));
    }
    if matches!(module, AppDataModule::Poetry) && state.poetry.is_active() {
        return Err(AppError("请先停止诗词库同步".into()));
    }
    #[cfg(desktop)]
    if matches!(module, AppDataModule::BtCache) && state.bt.has_active_work()? {
        return Err(AppError("请先停止 BT 任务".into()));
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn app_data_usage(state: State<AppState>) -> AppResult<AppDataUsage> {
    Ok(state.storage.app_data_usage())
}

#[tauri::command]
#[specta::specta]
pub async fn app_data_clear(
    state: State<'_, AppState>,
    module: AppDataModule,
) -> AppResult<AppDataClearResult> {
    ensure_idle(&state, module)?;
    let before = state.storage.app_data_usage().total_bytes;
    let storage = state.storage.clone();
    let result = match module {
        AppDataModule::Vault
        | AppDataModule::Hosts
        | AppDataModule::Todo
        | AppDataModule::ActivityLogs => {
            run_blocking(move || {
                let count = storage.clear_data_module(module)?;
                Ok(storage.data_clear_result(module, count, before, Vec::new()))
            })
            .await?
        }
        AppDataModule::Poetry => {
            let storage = state.storage.clone();
            let poetry = state.poetry.clone();
            run_blocking(move || {
                poetry.delete_database()?;
                Ok(storage.data_clear_result(AppDataModule::Poetry, 0, before, Vec::new()))
            })
            .await?
        }
        AppDataModule::BtCache => {
            #[cfg(desktop)]
            {
                let count = state.bt.clear_cache().await? as u32;
                state.storage.data_clear_result(
                    AppDataModule::BtCache,
                    count,
                    before,
                    vec!["BT 任务记录和用户下载文件".into()],
                )
            }
            #[cfg(not(desktop))]
            {
                let _ = (state, before);
                return Err(AppError("BT cache is only available on desktop".into()));
            }
        }
    };
    Ok(result)
}

#[tauri::command]
#[specta::specta]
pub async fn app_data_reset(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> AppResult<AppDataResetResult> {
    if state.manager.is_busy()
        || state.lan_transfer.status().running
        || state.game_room.status().phase != "idle"
        || state.poetry.is_active()
    {
        return Err(AppError("请先停止所有连接、传输和同步任务".into()));
    }
    #[cfg(desktop)]
    if state.bt.has_active_work()? {
        return Err(AppError("请先停止所有连接、传输和同步任务".into()));
    }
    let before = state.storage.app_data_usage().total_bytes;
    #[cfg(desktop)]
    state.bt.shutdown();
    if state.storage.ai_connection()?.is_some() {
        crate::ai::clear_api_key_for_reset(&app).await?;
    }
    let storage = state.storage.clone();
    run_blocking(move || {
        let records_deleted = storage.reset_database()?;
        storage.clear_poetry_database()?;
        storage.remove_bt_internal_data()?;
        let journal = storage.root_path().join("transfer-temp-files.json");
        if journal.exists() {
            fs::remove_file(journal)?;
        }
        Ok(AppDataResetResult {
            records_deleted,
            bytes_freed: before.saturating_sub(storage.app_data_usage().total_bytes),
            preserved: vec!["BT 下载目录和局域网共享目录中的普通文件".into()],
        })
    })
    .await
}
