use super::environment::ModelEnvironment;
use crate::app::services::AppServices;
use crate::error::AppResult;
use tauri::State;

#[tauri::command]
#[specta::specta]
pub async fn model_environment_begin(
    state: State<'_, AppServices>,
    name: String,
    size: u32,
) -> AppResult<String> {
    let repository = state.model_library.clone();
    state
        .executor
        .blocking_unlogged(move || repository.environment_begin(&name, size))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn model_environment_write(
    state: State<'_, AppServices>,
    id: String,
    offset: u32,
    bytes: Vec<u8>,
) -> AppResult<()> {
    let repository = state.model_library.clone();
    state
        .executor
        .blocking_unlogged(move || repository.environment_write(&id, offset, &bytes))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn model_environment_commit(state: State<'_, AppServices>, id: String) -> AppResult<()> {
    let repository = state.model_library.clone();
    state
        .executor
        .blocking_unlogged(move || repository.environment_commit(&id))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn model_environment_current(
    state: State<'_, AppServices>,
) -> AppResult<Option<ModelEnvironment>> {
    let repository = state.model_library.clone();
    state
        .executor
        .blocking_unlogged(move || repository.environment_current())
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn model_environment_read(
    state: State<'_, AppServices>,
    id: String,
    offset: u32,
) -> AppResult<Vec<u8>> {
    let repository = state.model_library.clone();
    state
        .executor
        .blocking_unlogged(move || repository.environment_read(&id, offset))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn model_environment_abort(state: State<'_, AppServices>, id: String) -> AppResult<()> {
    let repository = state.model_library.clone();
    // Draft-only cleanup remains available while maintenance drains admitted work.
    crate::core::execution::run_blocking(move || repository.environment_abort(&id)).await
}

#[tauri::command]
#[specta::specta]
pub async fn model_environment_clear(state: State<'_, AppServices>) -> AppResult<()> {
    let repository = state.model_library.clone();
    state
        .executor
        .blocking_unlogged(move || repository.environment_clear())
        .await
}
