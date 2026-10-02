use crate::app::services::AppServices;
use crate::error::AppResult;
use crate::models::ActivityLog;
use tauri::State;

#[tauri::command]
#[specta::specta]
pub async fn activity_logs(
    state: State<'_, AppServices>,
    limit: Option<u32>,
    source: Option<String>,
    result: Option<String>,
) -> AppResult<Vec<ActivityLog>> {
    let storage = state.storage.clone();
    state
        .executor
        .blocking_unlogged(move || {
            storage.list_activity_logs(limit.unwrap_or(500), source.as_deref(), result.as_deref())
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn activity_logs_clear(state: State<'_, AppServices>) -> AppResult<()> {
    let storage = state.storage.clone();
    // Log management must not append a new row while clearing existing rows.
    state
        .executor
        .blocking_unlogged(move || storage.clear_activity_logs(None).map(|_| ()))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn activity_log_delete(state: State<'_, AppServices>, id: String) -> AppResult<()> {
    let storage = state.storage.clone();
    state
        .executor
        .blocking_unlogged(move || storage.delete_activity_log(&id))
        .await
}
