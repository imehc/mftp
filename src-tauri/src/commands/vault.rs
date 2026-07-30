use crate::error::AppResult;
use crate::models::{VaultEntry, VaultEntryInput};
use crate::AppState;
use tauri::State;

#[tauri::command]
#[specta::specta]
pub fn vault_entries_list(state: State<AppState>) -> AppResult<Vec<VaultEntry>> {
    state.storage.list_vault_entries()
}

#[tauri::command]
#[specta::specta]
pub fn vault_entry_create(state: State<AppState>, input: VaultEntryInput) -> AppResult<VaultEntry> {
    state.storage.create_vault_entry(input)
}

#[tauri::command]
#[specta::specta]
pub fn vault_entry_update(
    state: State<AppState>,
    id: String,
    input: VaultEntryInput,
) -> AppResult<VaultEntry> {
    state.storage.update_vault_entry(&id, input)
}

#[tauri::command]
#[specta::specta]
pub fn vault_entry_delete(state: State<AppState>, id: String) -> AppResult<()> {
    state.storage.delete_vault_entry(&id)
}
