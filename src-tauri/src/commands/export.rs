use crate::error::AppResult;
use crate::models::{ExportSection, ImportMode, ImportPreview, ImportReport};
use crate::AppState;
use tauri::State;

use super::run_blocking;

/// Serialize the selected sections as a JSON document, optionally encrypted
/// with a password (Argon2id + ChaCha20-Poly1305). The frontend handles the
/// save dialog / file write so browser dev mode works too.
#[tauri::command]
#[specta::specta]
pub async fn data_export(
    state: State<'_, AppState>,
    sections: Vec<ExportSection>,
    password: Option<String>,
) -> AppResult<String> {
    let storage = state.storage.clone();
    // Argon2 key derivation is CPU-heavy; keep it off the async runtime.
    run_blocking(move || storage.export_document(&sections, password.as_deref())).await
}

/// Detect whether a file is an mftp export and whether it is encrypted.
#[tauri::command]
#[specta::specta]
pub fn data_inspect(state: State<AppState>, raw: String) -> AppResult<ImportPreview> {
    state.storage.inspect_document(&raw)
}

#[tauri::command]
#[specta::specta]
pub async fn data_import(
    state: State<'_, AppState>,
    raw: String,
    password: Option<String>,
    mode: ImportMode,
) -> AppResult<ImportReport> {
    let storage = state.storage.clone();
    run_blocking(move || storage.import_document(&raw, password.as_deref(), mode)).await
}
