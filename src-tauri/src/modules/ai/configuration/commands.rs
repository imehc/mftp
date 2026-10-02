//! Typed management IPC. The existing four connection commands remain compatible.
use super::{input::*, model::AiConfigurationView};
use crate::{app::services::AppServices, error::AppResult};
use tauri::State;

#[tauri::command]
#[specta::specta]
pub async fn ai_configuration_get(state: State<'_, AppServices>) -> AppResult<AiConfigurationView> {
    state.ai_configuration.configuration().await
}
#[tauri::command]
#[specta::specta]
pub async fn ai_provider_create(
    state: State<'_, AppServices>,
    input: AiProviderCreateInput,
) -> AppResult<AiConfigurationView> {
    state.ai_configuration.create_provider(input).await
}
#[tauri::command]
#[specta::specta]
pub async fn ai_provider_update(
    state: State<'_, AppServices>,
    input: AiProviderUpdateInput,
) -> AppResult<AiConfigurationView> {
    state.ai_configuration.update_provider(input).await
}
#[tauri::command]
#[specta::specta]
pub async fn ai_provider_delete(
    state: State<'_, AppServices>,
    input: AiProviderDeleteInput,
) -> AppResult<AiConfigurationView> {
    state.ai_configuration.delete_provider(input).await
}
#[tauri::command]
#[specta::specta]
pub async fn ai_key_save(
    state: State<'_, AppServices>,
    input: AiKeySaveInput,
) -> AppResult<AiConfigurationView> {
    state.ai_configuration.save_key(input).await
}
#[tauri::command]
#[specta::specta]
pub async fn ai_key_delete(
    state: State<'_, AppServices>,
    input: AiKeyDeleteInput,
) -> AppResult<AiConfigurationView> {
    state.ai_configuration.delete_key(input).await
}
#[tauri::command]
#[specta::specta]
pub async fn ai_model_save(
    state: State<'_, AppServices>,
    input: AiModelSaveInput,
) -> AppResult<AiConfigurationView> {
    state.ai_configuration.save_model(input).await
}
#[tauri::command]
#[specta::specta]
pub async fn ai_model_delete(
    state: State<'_, AppServices>,
    input: AiModelDeleteInput,
) -> AppResult<AiConfigurationView> {
    state.ai_configuration.delete_model(input).await
}

#[tauri::command]
#[specta::specta]
pub async fn ai_provider_activate(
    state: State<'_, AppServices>,
    input: AiProviderTargetInput,
) -> AppResult<AiConfigurationView> {
    state.ai_configuration.activate_provider(input).await
}
#[tauri::command]
#[specta::specta]
pub async fn ai_provider_select(
    state: State<'_, AppServices>,
    input: AiProviderSelectionInput,
) -> AppResult<AiConfigurationView> {
    state.ai_configuration.select_provider_options(input).await
}
#[tauri::command]
#[specta::specta]
pub async fn ai_model_switch(
    state: State<'_, AppServices>,
    input: AiModelSwitchInput,
) -> AppResult<AiConfigurationView> {
    state.ai_configuration.switch_current_model(input).await
}
#[tauri::command]
#[specta::specta]
pub async fn ai_streaming_update(
    state: State<'_, AppServices>,
    input: AiStreamingUpdateInput,
) -> AppResult<AiConfigurationView> {
    state.ai_configuration.update_streaming(input).await
}
#[tauri::command]
#[specta::specta]
pub async fn ai_provider_test(
    state: State<'_, AppServices>,
    input: AiProviderTargetInput,
) -> AppResult<()> {
    state.ai_configuration.test_provider(input).await
}
