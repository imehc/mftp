use super::models::ModelImportSession;
use crate::app::services::AppServices;
use crate::error::AppResult;
use std::path::Path;
use tauri::State;

#[tauri::command]
#[specta::specta]
pub async fn model_viewer_open(
    state: State<'_, AppServices>,
    path: String,
) -> AppResult<ModelImportSession> {
    let service = state.model_viewer.clone();
    state
        .executor
        .blocking_unlogged(move || service.open(Path::new(&path)))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn model_viewer_attach(
    state: State<'_, AppServices>,
    id: String,
    key: String,
    path: String,
) -> AppResult<()> {
    let service = state.model_viewer.clone();
    state
        .executor
        .blocking_unlogged(move || service.attach(&id, key, Path::new(&path)))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn model_viewer_size(
    state: State<'_, AppServices>,
    id: String,
    key: String,
) -> AppResult<u32> {
    let service = state.model_viewer.clone();
    state
        .executor
        .blocking_unlogged(move || service.size(&id, &key))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn model_viewer_read(
    state: State<'_, AppServices>,
    id: String,
    key: String,
    offset: u32,
    length: u32,
) -> AppResult<Vec<u8>> {
    let service = state.model_viewer.clone();
    state
        .executor
        .blocking_unlogged(move || service.read(&id, &key, offset, length))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn model_viewer_close(state: State<'_, AppServices>, id: String) -> AppResult<()> {
    let service = state.model_viewer.clone();
    state
        .executor
        .blocking_unlogged(move || service.close(&id))
        .await
}
