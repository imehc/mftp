use crate::app::services::AppServices;
use crate::core::activity::OperationContext;
use crate::core::execution::{run_blocking, run_blocking_guarded};
use crate::error::{AppError, AppResult, CustomErrorCode};
use crate::modules::hosts::model::{AuthType, Host};
use crate::modules::keys::KeyRepository;
use crate::modules::ssh::SystemStats;
use crate::modules::ssh::{resolve_auth_material, AuthMaterial, AuthMethod};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use tauri::{AppHandle, State};

fn build_auth(
    key_repository: &KeyRepository,
    host: &Host,
    passphrase: Option<String>,
) -> AppResult<AuthMaterial> {
    let method = match host.auth_type {
        AuthType::Password => {
            let pw = host.password.clone().filter(|value| !value.is_empty());
            AuthMethod::Password(pw)
        }
        AuthType::Key => {
            let key_id = host
                .key_id
                .clone()
                .ok_or_else(|| AppError::custom(CustomErrorCode::SshKeyNotSelected))?;
            let private_key = key_repository.private_key(&key_id)?;
            AuthMethod::Key {
                private_key,
                passphrase,
            }
        }
    };
    resolve_auth_material(AuthMaterial {
        host: host.host.clone(),
        port: host.port,
        username: host.username.clone(),
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
    super::blocking(&state, context, move || {
        let mat = build_auth(&key_repository, &host, passphrase)?;
        let session_id = uuid::Uuid::new_v4().to_string();
        manager.register(&session_id, mat);
        Ok(session_id)
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
    super::blocking(&state, context, move || {
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
    super::blocking(&state, context, move || {
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
    run_blocking_guarded(state.manager.operation()?, move || {
        manager.system_stats(&session_id)
    })
    .await
}
