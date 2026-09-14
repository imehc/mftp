use crate::error::AppResult;
use crate::models::{VaultEntry, VaultEntryInput};
use crate::AppState;
use tauri::State;

use super::record_operation;

#[tauri::command]
#[specta::specta]
pub fn vault_entries_list(state: State<AppState>) -> AppResult<Vec<VaultEntry>> {
    state.storage.list_vault_entries()
}

#[tauri::command]
#[specta::specta]
pub fn vault_entry_create(state: State<AppState>, input: VaultEntryInput) -> AppResult<VaultEntry> {
    let result = state.storage.create_vault_entry(input);
    record_operation(&state.storage, "vault", "", "create", None, &result);
    result
}

#[tauri::command]
#[specta::specta]
pub fn vault_entry_update(
    state: State<AppState>,
    id: String,
    input: VaultEntryInput,
) -> AppResult<VaultEntry> {
    let result = state.storage.update_vault_entry(&id, input);
    record_operation(&state.storage, "vault", &id, "update", None, &result);
    result
}

#[tauri::command]
#[specta::specta]
pub fn vault_entries_reorder(
    state: State<AppState>,
    ordered_ids: Vec<String>,
) -> AppResult<Vec<VaultEntry>> {
    let result = state.storage.reorder_vault_entries(ordered_ids);
    record_operation(&state.storage, "vault", "", "reorder", None, &result);
    result
}

#[tauri::command]
#[specta::specta]
pub fn vault_entry_delete(state: State<AppState>, id: String) -> AppResult<()> {
    let result = state.storage.delete_vault_entry(&id);
    record_operation(&state.storage, "vault", &id, "delete", None, &result);
    result
}
