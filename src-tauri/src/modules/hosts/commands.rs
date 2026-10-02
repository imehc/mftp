use crate::app::services::AppServices;
use crate::core::activity::OperationContext;
use crate::error::AppResult;
use crate::modules::hosts::model::{Host, HostInput};
use tauri::State;

#[tauri::command]
#[specta::specta]
pub async fn hosts_list(state: State<'_, AppServices>) -> AppResult<Vec<Host>> {
    let repository = state.host_repository.clone();
    crate::core::execution::run_blocking(move || repository.list()).await
}

#[tauri::command]
#[specta::specta]
pub async fn host_get(state: State<'_, AppServices>, id: String) -> AppResult<Host> {
    let repository = state.host_repository.clone();
    crate::core::execution::run_blocking(move || repository.get(&id)).await
}

#[tauri::command]
#[specta::specta]
pub async fn host_create(state: State<'_, AppServices>, input: HostInput) -> AppResult<Host> {
    let repository = state.host_repository.clone();
    state
        .executor
        .blocking(OperationContext::new("hosts", "create", ""), move || {
            repository.create(input)
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn host_update(
    state: State<'_, AppServices>,
    id: String,
    input: HostInput,
) -> AppResult<Host> {
    let repository = state.host_repository.clone();
    state
        .executor
        .blocking(
            OperationContext::new("hosts", "update", id.clone()),
            move || repository.update(&id, input),
        )
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn host_delete(state: State<'_, AppServices>, id: String) -> AppResult<()> {
    let repository = state.host_repository.clone();
    state
        .executor
        .blocking(
            OperationContext::new("hosts", "delete", id.clone()),
            move || repository.delete(&id),
        )
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn hosts_reorder(
    state: State<'_, AppServices>,
    ordered_ids: Vec<String>,
) -> AppResult<Vec<Host>> {
    let repository = state.host_repository.clone();
    state
        .executor
        .blocking(OperationContext::new("hosts", "reorder", ""), move || {
            repository.reorder(ordered_ids)
        })
        .await
}
