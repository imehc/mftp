use super::model::{TodoItem, TodoItemInput};
use crate::app::services::AppServices;
use crate::core::activity::OperationContext;
use crate::error::AppResult;
use tauri::State;

#[tauri::command]
#[specta::specta]
pub async fn todo_items_list(state: State<'_, AppServices>) -> AppResult<Vec<TodoItem>> {
    let repository = state.todo_repository.clone();
    crate::core::execution::run_blocking(move || repository.list()).await
}

#[tauri::command]
#[specta::specta]
pub async fn todo_item_create(
    state: State<'_, AppServices>,
    input: TodoItemInput,
) -> AppResult<TodoItem> {
    let repository = state.todo_repository.clone();
    state
        .executor
        .blocking(OperationContext::new("todo", "create", ""), move || {
            repository.create(input)
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn todo_item_update(
    state: State<'_, AppServices>,
    id: String,
    input: TodoItemInput,
) -> AppResult<TodoItem> {
    let repository = state.todo_repository.clone();
    state
        .executor
        .blocking(
            OperationContext::new("todo", "update", id.clone()),
            move || repository.update(&id, input),
        )
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn todo_item_delete(state: State<'_, AppServices>, id: String) -> AppResult<()> {
    let repository = state.todo_repository.clone();
    state
        .executor
        .blocking(
            OperationContext::new("todo", "delete", id.clone()),
            move || repository.delete(&id),
        )
        .await
}
