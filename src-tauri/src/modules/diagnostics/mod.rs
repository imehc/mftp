use crate::{
    app::services::AppServices,
    core::logging::{LogFile, LogPage},
    error::AppResult,
};
use tauri::State;

#[tauri::command]
#[specta::specta]
pub fn diagnostics_snapshot(
    state: State<'_, AppServices>,
    after: u32,
) -> AppResult<crate::core::diagnostics::DiagnosticSnapshot> {
    Ok(state.diagnostics.snapshot(after))
}

#[tauri::command]
#[specta::specta]
pub async fn diagnostics_clear(state: State<'_, AppServices>) -> AppResult<()> {
    state.diagnostics.clear();
    let logs = state.storage.logs.clone();
    state
        .executor
        .blocking_unlogged(move || logs.clear(None))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn logs_page(
    state: State<'_, AppServices>,
    after: Option<String>,
    limit: Option<u32>,
) -> AppResult<LogPage> {
    let logs = state.storage.logs.clone();
    state
        .executor
        .blocking_unlogged(move || logs.page(after.as_deref(), limit.unwrap_or(100)))
        .await
}

#[tauri::command]
#[specta::specta]
pub fn logs_directory(state: State<'_, AppServices>) -> AppResult<String> {
    Ok(state.storage.logs.directory().display().to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn logs_files(state: State<'_, AppServices>) -> AppResult<Vec<LogFile>> {
    let logs = state.storage.logs.clone();
    state.executor.blocking_unlogged(move || logs.files()).await
}

#[tauri::command]
#[specta::specta]
pub async fn logs_usage(state: State<'_, AppServices>) -> AppResult<f64> {
    let logs = state.storage.logs.clone();
    state
        .executor
        .blocking_unlogged(move || logs.usage().map(|bytes| bytes as f64))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn logs_clear(state: State<'_, AppServices>, before: Option<i64>) -> AppResult<()> {
    let logs = state.storage.logs.clone();
    state
        .executor
        .blocking_unlogged(move || logs.clear(before))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn logs_detail(
    state: State<'_, AppServices>,
    id: String,
) -> AppResult<Option<crate::core::diagnostics::DiagnosticOperation>> {
    let logs = state.storage.logs.clone();
    state
        .executor
        .blocking_unlogged(move || logs.detail(&id))
        .await
}

#[cfg(any(desktop, target_os = "android"))]
#[tauri::command]
#[specta::specta]
pub async fn logs_open_directory(
    state: State<'_, AppServices>,
    app: tauri::AppHandle,
) -> AppResult<()> {
    let path = state.storage.logs.directory().to_path_buf();
    state
        .executor
        .blocking_unlogged(move || crate::file_opener::open(&app, &path))
        .await
}

#[cfg(target_os = "ios")]
#[tauri::command]
#[specta::specta]
pub fn logs_open_directory(_state: State<'_, AppServices>) -> AppResult<()> {
    Err(AppError::external(
        "logs:open-directory",
        "Opening a private log directory is unavailable on iOS",
    ))
}
