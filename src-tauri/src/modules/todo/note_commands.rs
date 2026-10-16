use super::model::TodoItem;
use super::note_model::{
    TodoNoteDetails, TodoNoteDraft, TodoNoteImageData, TodoNoteImageImport, TodoNoteImageInfo,
    TodoNoteSaveInput, TodoNoteSummary,
};
use crate::app::services::AppServices;
use crate::error::AppResult;
use tauri::State;

#[tauri::command]
#[specta::specta]
pub async fn todo_note_details(
    state: State<'_, AppServices>,
    id: String,
) -> AppResult<TodoNoteDetails> {
    let repository = state.todo_repository.clone();
    state
        .executor
        .blocking_unlogged(move || repository.note_details(&id))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn todo_note_summaries(state: State<'_, AppServices>) -> AppResult<Vec<TodoNoteSummary>> {
    let repository = state.todo_repository.clone();
    state
        .executor
        .blocking_unlogged(move || repository.note_summaries())
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn todo_note_draft_begin(
    state: State<'_, AppServices>,
    item_id: Option<String>,
) -> AppResult<TodoNoteDraft> {
    let repository = state.todo_repository.clone();
    state
        .executor
        .blocking_unlogged(move || repository.begin_note_draft(item_id.as_deref()))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn todo_note_draft_close(
    state: State<'_, AppServices>,
    draft_id: String,
) -> AppResult<()> {
    let notes = state.todo_notes.clone();
    state
        .executor
        .blocking_unlogged(move || notes.close_draft(&draft_id))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn todo_note_image_import(
    state: State<'_, AppServices>,
    draft_id: String,
    data_base64: String,
) -> AppResult<TodoNoteImageImport> {
    let notes = state.todo_notes.clone();
    state
        .executor
        .blocking_unlogged(move || notes.import_image(&draft_id, &data_base64))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn todo_note_image_read(
    state: State<'_, AppServices>,
    asset_id: String,
    item_id: Option<String>,
    draft_id: Option<String>,
    thumbnail: bool,
) -> AppResult<TodoNoteImageData> {
    let repository = state.todo_repository.clone();
    state
        .executor
        .blocking_unlogged(move || {
            repository.note_image_data(
                &asset_id,
                item_id.as_deref(),
                draft_id.as_deref(),
                thumbnail,
            )
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn todo_note_image_copy(
    state: State<'_, AppServices>,
    draft_id: String,
    source_item_id: String,
    asset_id: String,
) -> AppResult<TodoNoteImageInfo> {
    let repository = state.todo_repository.clone();
    state
        .executor
        .blocking_unlogged(move || {
            repository.copy_note_image(&draft_id, &source_item_id, &asset_id)
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn todo_note_save(
    state: State<'_, AppServices>,
    input: TodoNoteSaveInput,
) -> AppResult<TodoNoteDetails> {
    let notes = state.todo_notes.clone();
    state
        .executor
        .blocking_unlogged(move || notes.save(input))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn todo_item_set_completed(
    state: State<'_, AppServices>,
    id: String,
    completed: bool,
) -> AppResult<TodoItem> {
    let repository = state.todo_repository.clone();
    state
        .executor
        .blocking_unlogged(move || repository.set_completed(&id, completed))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn todo_item_set_abandoned(
    state: State<'_, AppServices>,
    id: String,
    abandoned: bool,
) -> AppResult<TodoItem> {
    let repository = state.todo_repository.clone();
    state
        .executor
        .blocking_unlogged(move || repository.set_abandoned(&id, abandoned))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn todo_note_clipboard_read(
    state: State<'_, AppServices>,
    draft_id: String,
    text_only: bool,
) -> AppResult<super::note_model::TodoNoteClipboard> {
    let notes = state.todo_notes.clone();
    state
        .executor
        .blocking_unlogged(move || {
            #[cfg(desktop)]
            {
                super::note_clipboard::read(&notes, &draft_id, text_only)
            }
            #[cfg(mobile)]
            {
                let _ = (notes, draft_id, text_only);
                Err(crate::error::AppError::custom(
                    crate::error::CustomErrorCode::TodoNoteImageUnsupported,
                ))
            }
        })
        .await
}
