use crate::error::AppResult;
use crate::models::{Host, HostInput};
use crate::AppState;
use tauri::State;

#[tauri::command]
pub fn hosts_list(state: State<AppState>) -> AppResult<Vec<Host>> {
    state.storage.list_hosts()
}

#[tauri::command]
pub fn host_get(state: State<AppState>, id: String) -> AppResult<Host> {
    state.storage.get_host(&id)
}

#[tauri::command]
pub fn host_create(state: State<AppState>, input: HostInput) -> AppResult<Host> {
    state.storage.create_host(input)
}

#[tauri::command]
pub fn host_update(state: State<AppState>, id: String, input: HostInput) -> AppResult<Host> {
    state.storage.update_host(&id, input)
}

#[tauri::command]
pub fn host_delete(state: State<AppState>, id: String) -> AppResult<()> {
    state.storage.delete_host(&id)
}

#[tauri::command]
pub fn hosts_reorder(state: State<AppState>, ordered_ids: Vec<String>) -> AppResult<Vec<Host>> {
    state.storage.reorder_hosts(ordered_ids)
}
