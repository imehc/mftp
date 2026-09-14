use crate::error::AppResult;
use crate::models::SshKey;
use crate::AppState;
use tauri::State;

use super::record_operation;

#[tauri::command]
#[specta::specta]
pub fn keys_list(state: State<AppState>) -> AppResult<Vec<SshKey>> {
    state.storage.list_keys()
}

#[tauri::command]
#[specta::specta]
pub fn key_import(
    state: State<AppState>,
    label: String,
    source_path: String,
    has_passphrase: bool,
) -> AppResult<SshKey> {
    let result = state
        .storage
        .import_key(label, &source_path, has_passphrase);
    record_operation(
        &state.storage,
        "hosts",
        &source_path,
        "key_import",
        None,
        &result,
    );
    result
}

#[tauri::command]
#[specta::specta]
pub fn key_delete(state: State<AppState>, id: String) -> AppResult<()> {
    let result = state.storage.delete_key(&id);
    record_operation(&state.storage, "hosts", &id, "key_delete", None, &result);
    result
}
