use crate::app::services::AppServices;
use crate::core::activity::OperationContext;
use crate::error::AppResult;
use crate::modules::vault::model::{VaultEntry, VaultEntryInput};
use tauri::State;

#[tauri::command]
#[specta::specta]
pub async fn vault_entries_list(state: State<'_, AppServices>) -> AppResult<Vec<VaultEntry>> {
    let repository = state.vault_repository.clone();
    crate::core::execution::run_blocking(move || repository.list()).await
}

#[tauri::command]
#[specta::specta]
pub async fn vault_entry_create(
    state: State<'_, AppServices>,
    input: VaultEntryInput,
) -> AppResult<VaultEntry> {
    let repository = state.vault_repository.clone();
    state
        .executor
        .blocking(OperationContext::new("vault", "create", ""), move || {
            repository.create(input)
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn vault_entry_update(
    state: State<'_, AppServices>,
    id: String,
    input: VaultEntryInput,
) -> AppResult<VaultEntry> {
    let repository = state.vault_repository.clone();
    state
        .executor
        .blocking(
            OperationContext::new("vault", "update", id.clone()),
            move || repository.update(&id, input),
        )
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn vault_entries_reorder(
    state: State<'_, AppServices>,
    ordered_ids: Vec<String>,
) -> AppResult<Vec<VaultEntry>> {
    let repository = state.vault_repository.clone();
    state
        .executor
        .blocking(OperationContext::new("vault", "reorder", ""), move || {
            repository.reorder(ordered_ids)
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn vault_entry_delete(state: State<'_, AppServices>, id: String) -> AppResult<()> {
    let repository = state.vault_repository.clone();
    state
        .executor
        .blocking(
            OperationContext::new("vault", "delete", id.clone()),
            move || repository.delete(&id),
        )
        .await
}
