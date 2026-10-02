use crate::app::services::AppServices;
use crate::core::activity::OperationContext;
use crate::error::AppResult;
use crate::models::{ExportSection, ImportMode, ImportPreview, ImportReport};
use tauri::State;

/// Serialize the selected sections as a JSON document, optionally encrypted
/// with a password (Argon2id + ChaCha20-Poly1305). The frontend handles the
/// save dialog / file write so browser dev mode works too.
#[tauri::command]
#[specta::specta]
pub async fn data_export(
    state: State<'_, AppServices>,
    sections: Vec<ExportSection>,
    password: Option<String>,
) -> AppResult<String> {
    let storage = state.storage.clone();
    // Keep admission through serialization, Argon2 and the final log even if
    // the IPC waiter disappears. Document contents/passwords are not metadata.
    state
        .executor
        .blocking(OperationContext::new("data", "export", ""), move || {
            storage.export_document(&sections, password.as_deref())
        })
        .await
}

/// Detect whether a file is an mftp export and whether it is encrypted.
#[tauri::command]
#[specta::specta]
pub async fn data_inspect(state: State<'_, AppServices>, raw: String) -> AppResult<ImportPreview> {
    let storage = state.storage.clone();
    state
        .executor
        .blocking_unlogged(move || storage.inspect_document(&raw))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn data_import(
    state: State<'_, AppServices>,
    raw: String,
    password: Option<String>,
    mode: ImportMode,
) -> AppResult<ImportReport> {
    let storage = state.storage.clone();
    state
        .executor
        .blocking(OperationContext::new("data", "import", ""), move || {
            storage.import_document(&raw, password.as_deref(), mode)
        })
        .await
}
