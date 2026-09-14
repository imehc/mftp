use crate::error::AppResult;
use crate::models::{Host, HostInput};
use crate::AppState;
use tauri::State;

use super::record_operation;

#[tauri::command]
#[specta::specta]
pub fn hosts_list(state: State<AppState>) -> AppResult<Vec<Host>> {
    state.storage.list_hosts()
}

#[tauri::command]
#[specta::specta]
pub fn host_get(state: State<AppState>, id: String) -> AppResult<Host> {
    state.storage.get_host(&id)
}

#[tauri::command]
#[specta::specta]
pub fn host_create(state: State<AppState>, input: HostInput) -> AppResult<Host> {
    let result = state.storage.create_host(input);
    record_operation(&state.storage, "hosts", "", "create", None, &result);
    result
}

#[tauri::command]
#[specta::specta]
pub fn host_update(state: State<AppState>, id: String, input: HostInput) -> AppResult<Host> {
    let result = state.storage.update_host(&id, input);
    record_operation(&state.storage, "hosts", &id, "update", None, &result);
    result
}

#[tauri::command]
#[specta::specta]
pub fn host_delete(state: State<AppState>, id: String) -> AppResult<()> {
    let result = state.storage.delete_host(&id);
    record_operation(&state.storage, "hosts", &id, "delete", None, &result);
    result
}

#[tauri::command]
#[specta::specta]
pub fn hosts_reorder(state: State<AppState>, ordered_ids: Vec<String>) -> AppResult<Vec<Host>> {
    let result = state.storage.reorder_hosts(ordered_ids);
    record_operation(&state.storage, "hosts", "", "reorder", None, &result);
    result
}
