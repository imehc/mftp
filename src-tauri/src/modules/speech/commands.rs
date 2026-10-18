use std::sync::Arc;
use tauri::State;

use super::model::{SpeechAction, SpeechCatalog, SpeechRequest, SpeechSnapshot};
use crate::adapters::speech;
use crate::app::services::AppServices;
use crate::error::AppResult;

#[tauri::command]
#[specta::specta]
pub async fn speech_catalog(app: tauri::AppHandle) -> AppResult<SpeechCatalog> {
    speech::catalog(&app).await
}

#[tauri::command]
#[specta::specta]
pub fn speech_snapshot(state: State<'_, AppServices>) -> SpeechSnapshot {
    state.speech.snapshot()
}

#[tauri::command]
#[specta::specta]
pub async fn speech_start(
    app: tauri::AppHandle,
    state: State<'_, AppServices>,
    request: SpeechRequest,
) -> AppResult<SpeechSnapshot> {
    super::validate(&request)?;
    let speech_state = Arc::clone(&state.speech);
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    let session_id = request.session_id.clone();
    let result = speech::start(app.clone(), speech_state, request).await?;
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        let speech_state = Arc::clone(&state.speech);
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(15)).await;
            // AVSpeechSynthesizer has no failure delegate; check and stop atomically on its main thread.
            speech::check_startup(app, speech_state, session_id).await;
        });
    }
    Ok(result)
}

#[tauri::command]
#[specta::specta]
pub async fn speech_control(
    app: tauri::AppHandle,
    state: State<'_, AppServices>,
    session_id: String,
    action: SpeechAction,
) -> AppResult<SpeechSnapshot> {
    let speech_state = Arc::clone(&state.speech);
    speech::control(&app, &speech_state, &session_id, action).await
}

#[tauri::command]
#[specta::specta]
pub async fn speech_stop(
    app: tauri::AppHandle,
    state: State<'_, AppServices>,
    session_id: String,
) -> AppResult<SpeechSnapshot> {
    speech_control(app, state, session_id, SpeechAction::Stop).await
}
