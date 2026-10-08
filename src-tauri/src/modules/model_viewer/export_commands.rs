use super::export_store::export_error;
use crate::app::services::AppServices;
use crate::error::AppResult;
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::State;

#[derive(Clone, Copy, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ModelExportAction {
    Save,
    Share,
}

#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ModelExportOutcome {
    Saved,
    Cancelled,
    Presented,
}

#[tauri::command]
#[specta::specta]
pub async fn model_export_begin(
    state: State<'_, AppServices>,
    name: String,
    size: u32,
) -> AppResult<String> {
    if !cfg!(mobile) {
        return Err(export_error("model:export_mobile_only"));
    }
    let store = state.model_exports.clone();
    state
        .executor
        .blocking_unlogged(move || store.begin(name, size))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn model_export_write(
    state: State<'_, AppServices>,
    id: String,
    offset: u32,
    bytes: Vec<u8>,
) -> AppResult<()> {
    let store = state.model_exports.clone();
    state
        .executor
        .blocking_unlogged(move || store.write(&id, offset, &bytes))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn model_export_present(
    app: tauri::AppHandle,
    state: State<'_, AppServices>,
    id: String,
    action: ModelExportAction,
) -> AppResult<ModelExportOutcome> {
    let store = state.model_exports.clone();
    state
        .executor
        .blocking_unlogged(move || {
            let (path, mime) = store.prepare(&id)?;
            let result = tauri_plugin_native_export::present(
                &app,
                tauri_plugin_native_export::Request {
                    id: id.clone(),
                    path: path.to_string_lossy().into_owned(),
                    mime,
                    action: match action {
                        ModelExportAction::Save => "save",
                        ModelExportAction::Share => "share",
                    }
                    .into(),
                },
            );
            store.finish(&id);
            match result
                .map_err(|_| export_error("model:export_native"))?
                .outcome
                .as_str()
            {
                "saved" => Ok(ModelExportOutcome::Saved),
                "cancelled" => Ok(ModelExportOutcome::Cancelled),
                "presented" => Ok(ModelExportOutcome::Presented),
                "busy" => Err(export_error("model:export_busy")),
                _ => Err(export_error("model:export_native")),
            }
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn model_export_cancel(app: tauri::AppHandle, id: String) -> AppResult<()> {
    if uuid::Uuid::parse_str(&id).is_err() {
        return Err(export_error("model:export_invalid"));
    }
    // Cancellation must remain callable while a maintenance gate is waiting on the real export worker.
    crate::core::execution::run_blocking(move || {
        tauri_plugin_native_export::cancel(&app, id)
            .map_err(|_| export_error("model:export_native"))
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn model_export_close(state: State<'_, AppServices>, id: String) -> AppResult<()> {
    let store = state.model_exports.clone();
    // Closing an owned scratch resource must not acquire a fresh business-operation permit.
    crate::core::execution::run_blocking(move || store.close(&id)).await
}
