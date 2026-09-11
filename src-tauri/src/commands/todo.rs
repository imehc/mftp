use crate::error::AppResult;
use crate::models::{TodoItem, TodoItemInput};
use crate::AppState;
use tauri::State;

#[tauri::command]
#[specta::specta]
pub fn todo_items_list(state: State<AppState>) -> AppResult<Vec<TodoItem>> {
    state.storage.list_todo_items()
}

#[tauri::command]
#[specta::specta]
pub fn todo_item_create(state: State<AppState>, input: TodoItemInput) -> AppResult<TodoItem> {
    state.storage.create_todo_item(input)
}

#[tauri::command]
#[specta::specta]
pub fn todo_item_update(
    state: State<AppState>,
    id: String,
    input: TodoItemInput,
) -> AppResult<TodoItem> {
    state.storage.update_todo_item(&id, input)
}

#[tauri::command]
#[specta::specta]
pub fn todo_item_delete(state: State<AppState>, id: String) -> AppResult<()> {
    state.storage.delete_todo_item(&id)
}
