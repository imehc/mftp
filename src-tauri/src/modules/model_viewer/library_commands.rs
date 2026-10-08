use super::library_models::*;
use crate::app::services::AppServices;
use crate::error::AppResult;
use tauri::State;

#[tauri::command]
#[specta::specta]
pub async fn model_library_catalog(
    state: State<'_, AppServices>,
) -> AppResult<ModelLibraryCatalog> {
    let repository = state.model_library.clone();
    state
        .executor
        .blocking_unlogged(move || repository.catalog())
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn model_library_begin(
    state: State<'_, AppServices>,
    input: ModelLibraryInput,
) -> AppResult<String> {
    let repository = state.model_library.clone();
    state
        .executor
        .blocking_unlogged(move || repository.begin(input))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn model_library_write(
    state: State<'_, AppServices>,
    id: String,
    key: String,
    offset: u32,
    bytes: Vec<u8>,
) -> AppResult<()> {
    let repository = state.model_library.clone();
    state
        .executor
        .blocking_unlogged(move || repository.write(&id, &key, offset, &bytes))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn model_library_commit(state: State<'_, AppServices>, id: String) -> AppResult<()> {
    let repository = state.model_library.clone();
    state
        .executor
        .blocking_unlogged(move || repository.commit(&id))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn model_library_document(
    state: State<'_, AppServices>,
    id: String,
) -> AppResult<ModelLibraryDocument> {
    let repository = state.model_library.clone();
    state
        .executor
        .blocking_unlogged(move || repository.document(&id))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn model_library_read(
    state: State<'_, AppServices>,
    id: String,
    key: String,
    offset: u32,
) -> AppResult<Vec<u8>> {
    let repository = state.model_library.clone();
    state
        .executor
        .blocking_unlogged(move || repository.read(&id, &key, offset))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn model_library_edit(
    state: State<'_, AppServices>,
    id: String,
    input: ModelLibraryEdit,
) -> AppResult<()> {
    let repository = state.model_library.clone();
    state
        .executor
        .blocking_unlogged(move || repository.edit(&id, input))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn model_library_save_view(
    state: State<'_, AppServices>,
    id: String,
    view: ModelViewState,
) -> AppResult<()> {
    let repository = state.model_library.clone();
    state
        .executor
        .blocking_unlogged(move || repository.save_view(&id, view))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn model_library_delete(
    state: State<'_, AppServices>,
    id: String,
    draft_only: bool,
) -> AppResult<()> {
    let repository = state.model_library.clone();
    state
        .executor
        .blocking_unlogged(move || repository.delete(&id, draft_only))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn model_library_thumbnail(
    state: State<'_, AppServices>,
    id: String,
    bytes: Vec<u8>,
) -> AppResult<()> {
    let repository = state.model_library.clone();
    state
        .executor
        .blocking_unlogged(move || repository.thumbnail(&id, &bytes))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn model_library_cache(
    state: State<'_, AppServices>,
    max: u32,
    clear: bool,
) -> AppResult<()> {
    let repository = state.model_library.clone();
    state
        .executor
        .blocking_unlogged(move || repository.configure_cache(max, clear))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn model_library_read_thumbnail(
    state: State<'_, AppServices>,
    id: String,
) -> AppResult<Option<String>> {
    let repository = state.model_library.clone();
    state
        .executor
        .blocking_unlogged(move || repository.read_thumbnail(&id))
        .await
}
