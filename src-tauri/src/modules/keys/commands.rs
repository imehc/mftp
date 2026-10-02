use crate::app::services::AppServices;
use crate::core::activity::OperationContext;
use crate::error::AppResult;
use crate::modules::keys::model::SshKey;
use tauri::State;

#[tauri::command]
#[specta::specta]
pub async fn keys_list(state: State<'_, AppServices>) -> AppResult<Vec<SshKey>> {
    let repository = state.key_repository.clone();
    crate::core::execution::run_blocking(move || repository.list()).await
}

#[tauri::command]
#[specta::specta]
pub async fn key_import(
    state: State<'_, AppServices>,
    label: String,
    source_path: String,
    has_passphrase: bool,
) -> AppResult<SshKey> {
    let repository = state.key_repository.clone();
    state
        .executor
        .blocking(
            OperationContext::new("hosts", "key_import", source_path.clone()),
            move || repository.import(label, &source_path, has_passphrase),
        )
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn key_delete(state: State<'_, AppServices>, id: String) -> AppResult<()> {
    let repository = state.key_repository.clone();
    state
        .executor
        .blocking(
            OperationContext::new("hosts", "key_delete", id.clone()),
            move || repository.delete(&id),
        )
        .await
}
