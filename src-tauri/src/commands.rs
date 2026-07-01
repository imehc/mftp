use crate::error::{AppError, AppResult};
use crate::models::{AuthType, Host, HostInput, SftpEntry, SshKey};
use crate::ssh::{AuthMaterial, AuthMethod};
use crate::AppState;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use tauri::{AppHandle, State};

// ---------- Hosts ----------

#[tauri::command]
pub fn hosts_list(state: State<AppState>) -> AppResult<Vec<Host>> {
    state.storage.list_hosts()
}

#[tauri::command]
pub fn host_get(state: State<AppState>, id: String) -> AppResult<Host> {
    state.storage.get_host(&id)
}

#[tauri::command]
pub fn host_create(state: State<AppState>, input: HostInput) -> AppResult<Host> {
    state.storage.create_host(input)
}

#[tauri::command]
pub fn host_update(state: State<AppState>, id: String, input: HostInput) -> AppResult<Host> {
    state.storage.update_host(&id, input)
}

#[tauri::command]
pub fn host_delete(state: State<AppState>, id: String) -> AppResult<()> {
    state.storage.delete_host(&id)
}

// ---------- Keys ----------

#[tauri::command]
pub fn keys_list(state: State<AppState>) -> AppResult<Vec<SshKey>> {
    state.storage.list_keys()
}

#[tauri::command]
pub fn key_import(
    state: State<AppState>,
    label: String,
    source_path: String,
    has_passphrase: bool,
) -> AppResult<SshKey> {
    state
        .storage
        .import_key(label, &source_path, has_passphrase)
}

#[tauri::command]
pub fn key_delete(state: State<AppState>, id: String) -> AppResult<()> {
    state.storage.delete_key(&id)
}

// ---------- SSH ----------

/// Build auth material for a host, resolving key file path + optional passphrase.
fn build_auth(state: &AppState, host: &Host, passphrase: Option<String>) -> AppResult<AuthMaterial> {
    let method = match host.auth_type {
        AuthType::Password => {
            let pw = host
                .password
                .clone()
                .ok_or_else(|| AppError("host has no password".into()))?;
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
    Ok(AuthMaterial {
        host: host.host.clone(),
        port: host.port,
        username: host.username.clone(),
        method,
    })
}

/// Register a new session for a host. Returns a session id the frontend uses
/// to open shells / run sftp. Auth material is validated lazily on first use.
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
pub fn ssh_open_shell(
    app: AppHandle,
    state: State<AppState>,
    session_id: String,
    cols: u32,
    rows: u32,
) -> AppResult<()> {
    state.manager.open_shell(app, &session_id, cols, rows)
}

#[tauri::command]
pub fn ssh_write(state: State<AppState>, session_id: String, data: String) -> AppResult<()> {
    // `data` is base64-encoded raw bytes from the terminal.
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
pub fn ssh_disconnect(state: State<AppState>, session_id: String) -> AppResult<()> {
    state.manager.disconnect(&session_id);
    Ok(())
}

// ---------- SFTP ----------

#[tauri::command]
pub fn sftp_home(state: State<AppState>, session_id: String) -> AppResult<String> {
    state.manager.sftp_home(&session_id)
}

#[tauri::command]
pub fn sftp_list(
    state: State<AppState>,
    session_id: String,
    path: String,
) -> AppResult<Vec<SftpEntry>> {
    state.manager.sftp_list(&session_id, &path)
}

#[tauri::command]
pub fn sftp_mkdir(state: State<AppState>, session_id: String, path: String) -> AppResult<()> {
    state.manager.sftp_mkdir(&session_id, &path)
}

#[tauri::command]
pub fn sftp_rename(
    state: State<AppState>,
    session_id: String,
    from: String,
    to: String,
) -> AppResult<()> {
    state.manager.sftp_rename(&session_id, &from, &to)
}

#[tauri::command]
pub fn sftp_delete(
    state: State<AppState>,
    session_id: String,
    path: String,
    is_dir: bool,
) -> AppResult<()> {
    state.manager.sftp_delete(&session_id, &path, is_dir)
}

#[tauri::command]
pub fn sftp_download(
    state: State<AppState>,
    session_id: String,
    remote: String,
    local: String,
) -> AppResult<()> {
    state.manager.sftp_download(&session_id, &remote, &local)
}

#[tauri::command]
pub fn sftp_upload(
    state: State<AppState>,
    session_id: String,
    local: String,
    remote: String,
) -> AppResult<()> {
    state.manager.sftp_upload(&session_id, &local, &remote)
}
