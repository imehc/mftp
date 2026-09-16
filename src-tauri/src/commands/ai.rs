use tauri::{AppHandle, State};

use crate::ai::{
    clear_api_key, has_api_key, read_api_key, save_api_key, test_connection, validate_connection,
    AiConnection, AiConnectionInput,
};
use crate::error::{AppError, AppResult};
use crate::AppState;

use super::run_blocking;

#[tauri::command]
#[specta::specta]
pub async fn ai_connection_get(
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<AiConnection> {
    let storage = state.storage.clone();
    let config = run_blocking(move || storage.ai_connection()).await?;
    Ok(AiConnection {
        base_url: config
            .as_ref()
            .map(|value| value.base_url.clone())
            .unwrap_or_default(),
        model: config
            .as_ref()
            .map(|value| value.model.clone())
            .unwrap_or_default(),
        streaming_enabled: config.map(|value| value.streaming_enabled).unwrap_or(true),
        has_key: has_api_key(&app).await?,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn ai_connection_save(
    app: AppHandle,
    state: State<'_, AppState>,
    input: AiConnectionInput,
) -> AppResult<AiConnection> {
    let storage = state.storage.clone();
    let mut config = validate_connection(&input.base_url, &input.model)?;
    config.streaming_enabled = input.streaming_enabled;
    let replacement = input.api_key.as_deref();
    let previous_api_key = if replacement.is_some() {
        read_api_key(&app).await?
    } else {
        None
    };
    if let Some(api_key) = replacement {
        save_api_key(&app, api_key).await?;
    }
    let save_config = config.clone();
    if let Err(error) = run_blocking(move || storage.save_ai_connection(&save_config)).await {
        if replacement.is_some() {
            let rollback = match previous_api_key.as_deref() {
                Some(api_key) => save_api_key(&app, api_key).await,
                None => clear_api_key(&app).await,
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
        streaming_enabled: config.streaming_enabled,
        has_key: replacement.is_some() || previous_api_key.is_some() || has_api_key(&app).await?,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn ai_connection_clear_key(
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<AiConnection> {
    clear_api_key(&app).await?;
    let storage = state.storage.clone();
    let config = run_blocking(move || storage.ai_connection()).await?;
    Ok(AiConnection {
        base_url: config
            .as_ref()
            .map(|value| value.base_url.clone())
            .unwrap_or_default(),
        model: config
            .as_ref()
            .map(|value| value.model.clone())
            .unwrap_or_default(),
        streaming_enabled: config.map(|value| value.streaming_enabled).unwrap_or(true),
        has_key: false,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn ai_connection_test(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    let storage = state.storage.clone();
    let config = run_blocking(move || {
        storage
            .ai_connection()?
            .ok_or_else(|| AppError("Save the AI service address and model first".into()))
    })
    .await?;
    let api_key = read_api_key(&app)
        .await?
        .ok_or_else(|| AppError("Save an API key before testing the connection".into()))?;
    run_blocking(move || test_connection(&config, &api_key)).await
}
