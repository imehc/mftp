use crate::{
    app::services::AppServices,
    core::{
        execution::{run_blocking, run_blocking_guarded},
        operations::MaintenanceLease,
    },
    error::{AppError, AppResult},
    models::{AppDataResetFailure, AppDataResetProgress, AppDataResetResult, AppDataResetStep},
};
use std::sync::Arc;
use tauri::State;

pub(crate) fn is_recovery_command(command: &str) -> bool {
    matches!(
        command,
        "app_data_reset_status" | "app_data_reset_resume" | "app_data_reset_finish"
    )
}

#[tauri::command]
#[specta::specta]
pub async fn app_data_reset_status(
    state: State<'_, AppServices>,
) -> AppResult<Option<AppDataResetProgress>> {
    let lease = state.executor.recovery_maintenance().await?;
    let storage = state.storage.clone();
    run_blocking_guarded(lease, move || storage.reset_progress()).await
}

#[tauri::command]
#[specta::specta]
pub async fn app_data_reset_resume(
    state: State<'_, AppServices>,
    id: String,
) -> AppResult<AppDataResetResult> {
    let maintenance = Arc::new(state.executor.recovery_maintenance().await?);
    run_owned(state.inner().clone(), maintenance, Some(id)).await
}

#[tauri::command]
#[specta::specta]
pub async fn app_data_reset_finish(state: State<'_, AppServices>, id: String) -> AppResult<()> {
    let lease = state.executor.recovery_maintenance().await?;
    let storage = state.storage.clone();
    run_blocking_guarded(lease, move || storage.finish_app_reset(&id)).await
}

pub(super) async fn run_owned(
    state: AppServices,
    maintenance: Arc<MaintenanceLease>,
    id: Option<String>,
) -> AppResult<AppDataResetResult> {
    // The owned worker keeps every guard through all stages, even if the IPC
    // waiter is dropped during a SQL/file/native credential operation.
    tauri::async_runtime::spawn(async move {
        let storage = state.storage.clone();
        let existing =
            run_blocking(move || id.map(|id| storage.require_reset(&id)).transpose()).await?;
        let _ssh_maintenance = state.manager.maintenance().await?;
        state
            .lifecycle
            .ensure_no_busy(&state.lifecycle.participant_ids())?;
        #[cfg(any(desktop, target_os = "android"))]
        let _bt_maintenance = state.bt.maintenance().await?;
        let ssh = state.manager.clone();
        run_blocking(move || ssh.cleanup_local_temps()).await?;
        #[cfg(any(desktop, target_os = "android"))]
        state.bt.stop_background_work().await;
        let storage = state.storage.clone();
        let (mut progress, before) = run_blocking(move || {
            if let Some(progress) = existing {
                Ok((progress, None))
            } else {
                let before = storage.app_data_usage();
                Ok((storage.begin_app_reset()?, Some(before)))
            }
        })
        .await?;
        let mut failures = Vec::new();
        for step in progress.pending.clone() {
            let result = async {
                let storage = state.storage.clone();
                match step {
                    AppDataResetStep::Poetry => {
                        run_blocking(move || storage.clear_poetry_database()).await?
                    }
                    AppDataResetStep::Bt => {
                        run_blocking(move || storage.remove_bt_internal_data()).await?
                    }
                    AppDataResetStep::Credentials => {
                        state
                            .ai_configuration
                            .cleanup_after_reset(maintenance.clone())
                            .await?
                    }
                }
                let storage = state.storage.clone();
                let id = progress.id.clone();
                run_blocking(move || storage.complete_reset_step(&id, step)).await
            }
            .await;
            match result {
                Ok(updated) => progress = updated,
                Err(error) => failures.push(AppDataResetFailure { step, error }),
            }
        }
        let storage = state.storage.clone();
        let (bytes_freed, usage_error) = run_blocking(move || {
            Ok(before.map_or((None, None), |before| storage.freed_bytes(before)))
        })
        .await?;
        Ok(AppDataResetResult {
            records_deleted: progress.records_deleted,
            progress,
            failures,
            bytes_freed,
            usage_error,
            preserved: vec![super::data::PRESERVED_USER_FILES.into()],
        })
    })
    .await
    .map_err(AppError::from)?
}
