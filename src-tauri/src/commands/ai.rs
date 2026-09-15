use tauri::State;

use crate::ai::{
    clear_api_key, has_api_key, read_api_key, save_api_key, test_connection, validate_connection,
    AiConnection, AiConnectionInput,
};
use crate::error::{AppError, AppResult};
use crate::AppState;

use super::run_blocking;

#[tauri::command]
#[specta::specta]
pub async fn ai_connection_get(state: State<'_, AppState>) -> AppResult<AiConnection> {
    let storage = state.storage.clone();
    run_blocking(move || {
        let config = storage.ai_connection()?;
        Ok(AiConnection {
            base_url: config
                .as_ref()
                .map(|value| value.base_url.clone())
                .unwrap_or_default(),
            model: config.map(|value| value.model).unwrap_or_default(),
            has_key: has_api_key()?,
        })
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn ai_connection_save(
    state: State<'_, AppState>,
    input: AiConnectionInput,
) -> AppResult<AiConnection> {
    let storage = state.storage.clone();
    run_blocking(move || {
        let config = validate_connection(&input.base_url, &input.model)?;
        let replacement = input.api_key.as_deref();
        let previous_api_key = if replacement.is_some() {
            read_api_key()?
        } else {
            None
        };
        if let Some(api_key) = replacement {
            save_api_key(api_key)?;
        }
        if let Err(error) = storage.save_ai_connection(&config) {
            if replacement.is_some() {
                let rollback = match previous_api_key.as_deref() {
                    Some(api_key) => save_api_key(api_key),
                    None => clear_api_key(),
                };
                if rollback.is_err() {
                    return Err(AppError(
                        "AI settings were not saved and credential rollback failed".into(),
                    ));
                }
            }
            return Err(error);
        }
        Ok(AiConnection {
            base_url: config.base_url,
            model: config.model,
            has_key: replacement.is_some() || previous_api_key.is_some() || has_api_key()?,
        })
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn ai_connection_clear_key(state: State<'_, AppState>) -> AppResult<AiConnection> {
    let storage = state.storage.clone();
    run_blocking(move || {
        clear_api_key()?;
        let config = storage.ai_connection()?;
        Ok(AiConnection {
            base_url: config
                .as_ref()
                .map(|value| value.base_url.clone())
                .unwrap_or_default(),
            model: config.map(|value| value.model).unwrap_or_default(),
            has_key: false,
        })
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn ai_connection_test(state: State<'_, AppState>) -> AppResult<()> {
    let storage = state.storage.clone();
    run_blocking(move || {
        let config = storage
            .ai_connection()?
            .ok_or_else(|| AppError("Save the AI service address and model first".into()))?;
        let api_key = read_api_key()?
            .ok_or_else(|| AppError("Save an API key before testing the connection".into()))?;
        test_connection(&config, &api_key)
    })
    .await
}
