use crate::{app::services::AppServices, core::diagnostics::DiagnosticSnapshot, error::AppResult};
use tauri::State;

#[tauri::command]
#[specta::specta]
pub fn diagnostics_snapshot(
    state: State<'_, AppServices>,
    after: u32,
) -> AppResult<DiagnosticSnapshot> {
    Ok(state.diagnostics.snapshot(after))
}

#[tauri::command]
#[specta::specta]
pub fn diagnostics_clear(state: State<'_, AppServices>) {
    state.diagnostics.clear();
}
