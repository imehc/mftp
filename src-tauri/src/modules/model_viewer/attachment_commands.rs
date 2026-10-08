use super::attachments::ModelAttachment;
use crate::app::services::AppServices;
use crate::error::AppResult;
use tauri::State;

#[tauri::command]
#[specta::specta]
pub async fn model_attachment_list(
    state: State<'_, AppServices>,
    model: String,
) -> AppResult<Vec<ModelAttachment>> {
    let repository = state.model_library.clone();
    state
        .executor
        .blocking_unlogged(move || repository.attachments(&model))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn model_attachment_add(
    state: State<'_, AppServices>,
    model: String,
    name: String,
    bytes: Vec<u8>,
) -> AppResult<String> {
    let repository = state.model_library.clone();
    state
        .executor
        .blocking_unlogged(move || repository.add_attachment(&model, &name, &bytes))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn model_attachment_read(
    state: State<'_, AppServices>,
    model: String,
    id: String,
) -> AppResult<Vec<u8>> {
    let repository = state.model_library.clone();
    state
        .executor
        .blocking_unlogged(move || repository.read_attachment(&model, &id))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn model_attachment_delete(
    state: State<'_, AppServices>,
    model: String,
    id: String,
) -> AppResult<()> {
    let repository = state.model_library.clone();
    state
        .executor
        .blocking_unlogged(move || repository.delete_attachment(&model, &id))
        .await
}
