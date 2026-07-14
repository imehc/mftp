use super::run_blocking;
use crate::error::{AppError, AppResult};
use crate::models::{AuthType, Host};
use crate::ssh::{resolve_auth_material, AuthMaterial, AuthMethod};
use crate::AppState;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use tauri::{AppHandle, State};

fn build_auth(
    state: &AppState,
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
                .ok_or_else(|| AppError("host has no key selected".into()))?;
            let path = state.storage.key_path(&key_id)?;
            AuthMethod::Key { path, passphrase }
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
pub fn ssh_connect(
    state: State<AppState>,
    host_id: String,
    passphrase: Option<String>,
) -> AppResult<String> {
    let host = state.storage.get_host(&host_id)?;
    let mat = build_auth(&state, &host, passphrase)?;
    let session_id = uuid::Uuid::new_v4().to_string();
    state.manager.register(&session_id, mat);
    Ok(session_id)
}

#[tauri::command]
pub async fn ssh_open_shell(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    cols: u32,
    rows: u32,
) -> AppResult<()> {
    let manager = state.manager.clone();
    run_blocking(move || manager.open_shell(app, &session_id, cols, rows)).await
}

#[tauri::command]
pub fn ssh_write(state: State<AppState>, session_id: String, data: String) -> AppResult<()> {
    let bytes = STANDARD
        .decode(data.as_bytes())
        .map_err(|e| AppError(format!("bad write payload: {e}")))?;
    state.manager.write(&session_id, &bytes)
}

#[tauri::command]
pub fn ssh_resize(
    state: State<AppState>,
    session_id: String,
    cols: u32,
    rows: u32,
) -> AppResult<()> {
    state.manager.resize(&session_id, cols, rows)
}

#[tauri::command]
pub async fn ssh_disconnect(state: State<'_, AppState>, session_id: String) -> AppResult<()> {
    let manager = state.manager.clone();
    run_blocking(move || {
        manager.disconnect(&session_id);
        Ok(())
    })
    .await
}
