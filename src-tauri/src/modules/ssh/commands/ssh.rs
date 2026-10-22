use crate::app::services::AppServices;
use crate::core::activity::OperationContext;
use crate::core::execution::run_blocking;
use crate::error::{AppError, AppResult, CustomErrorCode};
use crate::modules::hosts::model::{AuthType, HostInput};
use crate::modules::keys::KeyRepository;
use crate::modules::ssh::{auth_method, test_connection, SshConnectionTest, SystemStats};
use crate::modules::ssh::{resolve_auth_material, AuthMaterial};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use tauri::{AppHandle, State};

fn build_auth(
    key_repository: &KeyRepository,
    host: &str,
    port: u16,
    username: &str,
    auth_type: &AuthType,
    password: Option<&str>,
    key_id: Option<&str>,
    passphrase: Option<String>,
) -> AppResult<AuthMaterial> {
    let method = auth_method(
        auth_type,
        password,
        key_id,
        |id| key_repository.private_key(id),
        passphrase,
    )?;
    resolve_auth_material(AuthMaterial {
        host: host.to_string(),
        port,
        username: username.to_string(),
        method,
        identity_files: Vec::new(),
    })
}

#[tauri::command]
#[specta::specta]
pub async fn ssh_connect(
    state: State<'_, AppServices>,
    host_id: String,
    passphrase: Option<String>,
) -> AppResult<String> {
    // Resolve the host first (a plain DB read) so its hostname/label can become
    // safe log metadata; the SSH session registration runs under admission.
    let host = {
        let repository = state.host_repository.clone();
        run_blocking(move || repository.get(&host_id)).await?
    };
    let context =
        OperationContext::new("ssh", "connect", host.host.clone()).with_detail(host.label.clone());
    let key_repository = state.key_repository.clone();
    let manager = state.manager.clone();
    super::blocking(&state, context, None, move || {
        let mat = build_auth(
            &key_repository,
            &host.host,
            host.port,
            &host.username,
            &host.auth_type,
            host.password.as_deref(),
            host.key_id.as_deref(),
            passphrase,
        )?;
        let session_id = uuid::Uuid::new_v4().to_string();
        manager.register(&session_id, mat);
        Ok(session_id)
    })
    .await
}

/// Test an unsaved host configuration without touching stored data or session
/// state. Resolution, authentication and the SFTP check all run on the shared
/// blocking pipeline so the form gets the same failures a real connection would.
#[tauri::command]
#[specta::specta]
pub async fn ssh_test_connection(
    state: State<'_, AppServices>,
    input: HostInput,
    passphrase: Option<String>,
) -> AppResult<SshConnectionTest> {
    let context = OperationContext::new(
        "ssh",
        "test_connection",
        format!("{}:{}", input.host.trim(), input.port),
    )
    .with_detail(input.label.trim().to_string());
    let key_repository = state.key_repository.clone();
    super::blocking(&state, context, None, move || {
        let mat = build_auth(
            &key_repository,
            input.host.trim(),
            input.port,
            input.username.trim(),
            &input.auth_type,
            input.password.as_deref(),
            input.key_id.as_deref(),
            passphrase,
        )?;
        test_connection(&mat)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn ssh_open_shell(
    app: AppHandle,
    state: State<'_, AppServices>,
    session_id: String,
    cols: u32,
    rows: u32,
) -> AppResult<()> {
    let events = crate::adapters::ssh::event_sink(&app);
    let manager = state.manager.clone();
    let log_session = session_id.clone();
    let context = OperationContext::new("ssh", "open_shell", log_session);
    super::blocking(&state, context, None, move || {
        manager.open_shell(events, &session_id, cols, rows)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub fn ssh_write(state: State<AppServices>, session_id: String, data: String) -> AppResult<()> {
    let _operation = state.manager.operation()?;
    let bytes = STANDARD
        .decode(data.as_bytes())
        .map_err(|_| AppError::custom(CustomErrorCode::SshInvalidWritePayload))?;
    state.manager.write(&session_id, &bytes)
}

#[tauri::command]
#[specta::specta]
pub fn ssh_resize(
    state: State<AppServices>,
    session_id: String,
    cols: u32,
    rows: u32,
) -> AppResult<()> {
    let _operation = state.manager.operation()?;
    state.manager.resize(&session_id, cols, rows)
}

#[tauri::command]
#[specta::specta]
pub async fn ssh_disconnect(state: State<'_, AppServices>, session_id: String) -> AppResult<()> {
    let manager = state.manager.clone();
    let log_session = session_id.clone();
    let context = OperationContext::new("ssh", "disconnect", log_session);
    super::blocking(&state, context, None, move || {
        manager.disconnect(&session_id);
        Ok(())
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn ssh_system_stats(
    state: State<'_, AppServices>,
    session_id: String,
) -> AppResult<SystemStats> {
    let manager = state.manager.clone();
    super::reading(&state, &session_id.clone(), "ssh_system_stats", move || {
        manager.system_stats(&session_id)
    })
    .await
}
