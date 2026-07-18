use crate::error::AppResult;
use crate::models::SshKey;
use crate::AppState;
use tauri::State;

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
    state
        .storage
        .import_key(label, &source_path, has_passphrase)
}

#[tauri::command]
#[specta::specta]
pub fn key_delete(state: State<AppState>, id: String) -> AppResult<()> {
    state.storage.delete_key(&id)
}
