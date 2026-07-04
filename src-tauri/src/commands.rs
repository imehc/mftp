use crate::error::{AppError, AppResult};
use crate::models::{AuthType, Host, HostInput, SftpEntry, SftpFileInfo, SshKey};
use crate::ssh::{resolve_auth_material, AuthMaterial, AuthMethod, DirectoryTransferMode};
use crate::AppState;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use tauri::{AppHandle, State};

async fn run_blocking<T, F>(f: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> AppResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError(format!("background task failed: {e}")))?
}

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
pub async fn ssh_disconnect(state: State<'_, AppState>, session_id: String) -> AppResult<()> {
    let manager = state.manager.clone();
    run_blocking(move || {
        manager.disconnect(&session_id);
        Ok(())
    })
    .await
}

// ---------- SFTP ----------

#[tauri::command]
pub async fn sftp_home(state: State<'_, AppState>, session_id: String) -> AppResult<String> {
    let manager = state.manager.clone();
    run_blocking(move || manager.sftp_home(&session_id)).await
}

/// Resolve the first directory to open: the host's `preferred` default if it
/// exists, otherwise the home directory, otherwise "/".
#[tauri::command]
pub async fn sftp_start_dir(
    state: State<'_, AppState>,
    session_id: String,
    preferred: Option<String>,
) -> AppResult<String> {
    let manager = state.manager.clone();
    run_blocking(move || manager.sftp_start_dir(&session_id, preferred.as_deref())).await
}

#[tauri::command]
pub async fn sftp_list(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> AppResult<Vec<SftpEntry>> {
    let manager = state.manager.clone();
    run_blocking(move || manager.sftp_list(&session_id, &path)).await
}

#[tauri::command]
pub async fn sftp_info(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> AppResult<SftpFileInfo> {
    let manager = state.manager.clone();
    run_blocking(move || manager.sftp_info(&session_id, &path)).await
}

#[tauri::command]
pub async fn sftp_mkdir(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> AppResult<()> {
    let manager = state.manager.clone();
    run_blocking(move || manager.sftp_mkdir(&session_id, &path)).await
}

#[tauri::command]
pub async fn sftp_rename(
    state: State<'_, AppState>,
    session_id: String,
    from: String,
    to: String,
) -> AppResult<()> {
    let manager = state.manager.clone();
    run_blocking(move || manager.sftp_rename(&session_id, &from, &to)).await
}

#[tauri::command]
pub async fn sftp_delete(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    path: String,
    is_dir: bool,
    transfer_id: Option<String>,
) -> AppResult<()> {
    let manager = state.manager.clone();
    run_blocking(move || {
        manager.sftp_delete(
            &session_id,
            &path,
            is_dir,
            Some(&app),
            transfer_id.as_deref(),
        )
    })
    .await
}

#[tauri::command]
pub async fn sftp_download(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    remote: String,
    local: String,
    transfer_id: Option<String>,
) -> AppResult<()> {
    let manager = state.manager.clone();
    run_blocking(move || {
        manager.sftp_download(
            &session_id,
            &remote,
            &local,
            Some(&app),
            transfer_id.as_deref(),
        )
    })
    .await
}

#[tauri::command]
pub async fn sftp_upload(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    local: String,
    remote: String,
    transfer_id: Option<String>,
) -> AppResult<()> {
    let manager = state.manager.clone();
    run_blocking(move || {
        manager.sftp_upload(
            &session_id,
            &local,
            &remote,
            Some(&app),
            transfer_id.as_deref(),
        )
    })
    .await
}

#[tauri::command]
pub async fn sftp_exists(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> AppResult<bool> {
    let manager = state.manager.clone();
    run_blocking(move || manager.sftp_exists(&session_id, &path)).await
}

#[tauri::command]
pub async fn sftp_upload_dir(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    local_dir: String,
    remote_parent: String,
    remote_name: String,
    transfer_mode: Option<String>,
    transfer_id: Option<String>,
) -> AppResult<()> {
    let manager = state.manager.clone();
    run_blocking(move || {
        manager.sftp_upload_dir(
            &session_id,
            &local_dir,
            &remote_parent,
            &remote_name,
            DirectoryTransferMode::parse(transfer_mode.as_deref()),
            Some(&app),
            transfer_id.as_deref(),
        )
    })
    .await
}

#[tauri::command]
pub async fn sftp_download_dir(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    remote_dir: String,
    local_dir: String,
    transfer_mode: Option<String>,
    transfer_id: Option<String>,
) -> AppResult<()> {
    let manager = state.manager.clone();
    run_blocking(move || {
        manager.sftp_download_dir(
            &session_id,
            &remote_dir,
            &local_dir,
            DirectoryTransferMode::parse(transfer_mode.as_deref()),
            Some(&app),
            transfer_id.as_deref(),
        )
    })
    .await
}

#[tauri::command]
pub fn sftp_cancel_transfer(state: State<AppState>, transfer_id: String) -> AppResult<()> {
    state.manager.cancel_transfer(&transfer_id);
    Ok(())
}

#[tauri::command]
pub async fn sftp_extract(
    state: State<'_, AppState>,
    session_id: String,
    remote_archive: String,
    remote_parent: String,
    out_name: Option<String>,
) -> AppResult<()> {
    let manager = state.manager.clone();
    run_blocking(move || {
        manager.sftp_extract(
            &session_id,
            &remote_archive,
            &remote_parent,
            out_name.as_deref(),
        )
    })
    .await
}
