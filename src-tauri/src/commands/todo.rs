use crate::error::AppResult;
use crate::models::{TodoItem, TodoItemInput};
use crate::AppState;
use tauri::State;

use super::record_operation;

#[tauri::command]
#[specta::specta]
pub fn todo_items_list(state: State<AppState>) -> AppResult<Vec<TodoItem>> {
    state.storage.list_todo_items()
}

#[tauri::command]
#[specta::specta]
pub fn todo_item_create(state: State<AppState>, input: TodoItemInput) -> AppResult<TodoItem> {
    let result = state.storage.create_todo_item(input);
    record_operation(&state.storage, "todo", "", "create", None, &result);
    result
}

#[tauri::command]
#[specta::specta]
pub fn todo_item_update(
    state: State<AppState>,
    id: String,
    input: TodoItemInput,
) -> AppResult<TodoItem> {
    let result = state.storage.update_todo_item(&id, input);
    record_operation(&state.storage, "todo", &id, "update", None, &result);
    result
}

#[tauri::command]
#[specta::specta]
pub fn todo_item_delete(state: State<AppState>, id: String) -> AppResult<()> {
    let result = state.storage.delete_todo_item(&id);
    record_operation(&state.storage, "todo", &id, "delete", None, &result);
    result
}
