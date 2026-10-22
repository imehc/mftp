use tauri::State;

use super::model::{McpCredentialInput, McpIssuedCredential, McpModuleInfo, McpSnapshot};
use crate::core::execution::run_blocking;
use crate::{app::services::AppServices, error::AppResult};

#[tauri::command]
#[specta::specta]
pub async fn mcp_module_catalog(state: State<'_, AppServices>) -> AppResult<Vec<McpModuleInfo>> {
    Ok(state.mcp.registry.catalog())
}

#[tauri::command]
#[specta::specta]
pub async fn mcp_snapshot(state: State<'_, AppServices>) -> AppResult<McpSnapshot> {
    let server = state.mcp.server()?.clone();
    state
        .executor
        .blocking_unlogged(move || server.snapshot())
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn mcp_configure(state: State<'_, AppServices>, port: u16) -> AppResult<()> {
    let server = state.mcp.server()?.clone();
    state
        .executor
        .blocking_unlogged(move || server.configure(port))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn mcp_start(state: State<'_, AppServices>) -> AppResult<()> {
    state.lifecycle.check_admission()?;
    state.mcp.server()?.start().await
}

#[tauri::command]
#[specta::specta]
pub async fn mcp_stop(state: State<'_, AppServices>) -> AppResult<()> {
    let server = state.mcp.server()?.clone();
    run_blocking(move || {
        server.stop_blocking();
        Ok(())
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn mcp_credential_create(
    state: State<'_, AppServices>,
    input: McpCredentialInput,
) -> AppResult<McpIssuedCredential> {
    let server = state.mcp.server()?.clone();
    state
        .executor
        .blocking_unlogged(move || server.issue(input))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn mcp_credential_update(
    state: State<'_, AppServices>,
    id: String,
    input: McpCredentialInput,
) -> AppResult<()> {
    let server = state.mcp.server()?.clone();
    state
        .executor
        .blocking_unlogged(move || server.update(&id, input))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn mcp_credential_rotate(
    state: State<'_, AppServices>,
    id: String,
    input: McpCredentialInput,
) -> AppResult<McpIssuedCredential> {
    let server = state.mcp.server()?.clone();
    state
        .executor
        .blocking_unlogged(move || server.rotate(&id, input))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn mcp_credential_revoke(state: State<'_, AppServices>, id: String) -> AppResult<()> {
    let server = state.mcp.server()?.clone();
    state
        .executor
        .blocking_unlogged(move || server.revoke(&id))
        .await
}
