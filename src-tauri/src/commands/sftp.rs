use super::{record_operation, run_blocking};
use crate::error::AppResult;
use crate::models::{SftpEntry, SftpFileInfo};
use crate::ssh::DirectoryTransferMode;
use crate::AppState;
use tauri::{AppHandle, State};

#[tauri::command]
#[specta::specta]
pub async fn sftp_home(state: State<'_, AppState>, session_id: String) -> AppResult<String> {
    let manager = state.manager.clone();
    run_blocking(move || manager.sftp_home(&session_id)).await
}

#[tauri::command]
#[specta::specta]
pub async fn sftp_start_dir(
    state: State<'_, AppState>,
    session_id: String,
    preferred: Option<String>,
) -> AppResult<String> {
    let manager = state.manager.clone();
    run_blocking(move || manager.sftp_start_dir(&session_id, preferred.as_deref())).await
}

#[tauri::command]
#[specta::specta]
pub async fn sftp_list(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> AppResult<Vec<SftpEntry>> {
    let manager = state.manager.clone();
    run_blocking(move || manager.sftp_list(&session_id, &path)).await
}

#[tauri::command]
#[specta::specta]
pub async fn sftp_info(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> AppResult<SftpFileInfo> {
    let manager = state.manager.clone();
    run_blocking(move || manager.sftp_info(&session_id, &path)).await
}

#[tauri::command]
#[specta::specta]
pub async fn sftp_mkdir(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> AppResult<()> {
    let manager = state.manager.clone();
    let log_session = session_id.clone();
    let log_path = path.clone();
    let result = run_blocking(move || manager.sftp_mkdir(&session_id, &path)).await;
    record_operation(
        &state.storage,
        "sftp",
        &log_session,
        "mkdir",
        Some(&log_path),
        &result,
    );
    result
}

#[tauri::command]
#[specta::specta]
pub async fn sftp_rename(
    state: State<'_, AppState>,
    session_id: String,
    from: String,
    to: String,
) -> AppResult<()> {
    let manager = state.manager.clone();
    let log_session = session_id.clone();
    let detail = format!("{from} → {to}");
    let result = run_blocking(move || manager.sftp_rename(&session_id, &from, &to)).await;
    record_operation(
        &state.storage,
        "sftp",
        &log_session,
        "rename",
        Some(&detail),
        &result,
    );
    result
}

#[tauri::command]
#[specta::specta]
pub async fn sftp_delete(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    path: String,
    is_dir: bool,
    transfer_id: Option<String>,
) -> AppResult<()> {
    let manager = state.manager.clone();
    let log_session = session_id.clone();
    let log_path = path.clone();
    let result = run_blocking(move || {
        manager.sftp_delete(
            &session_id,
            &path,
            is_dir,
            Some(&app),
            transfer_id.as_deref(),
        )
    })
    .await;
    record_operation(
        &state.storage,
        "sftp",
        &log_session,
        "delete",
        Some(&log_path),
        &result,
    );
    result
}

#[tauri::command]
#[specta::specta]
pub async fn sftp_download(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    remote: String,
    local: String,
    transfer_id: Option<String>,
) -> AppResult<()> {
    let manager = state.manager.clone();
    let log_session = session_id.clone();
    let detail = format!("{remote} → {local}");
    let result = run_blocking(move || {
        manager.sftp_download(
            &session_id,
            &remote,
            &local,
            Some(&app),
            transfer_id.as_deref(),
        )
    })
    .await;
    record_operation(
        &state.storage,
        "sftp",
        &log_session,
        "download",
        Some(&detail),
        &result,
    );
    result
}

#[tauri::command]
#[specta::specta]
pub async fn sftp_upload(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    local: String,
    remote: String,
    transfer_id: Option<String>,
) -> AppResult<()> {
    let manager = state.manager.clone();
    let log_session = session_id.clone();
    let detail = format!("{local} → {remote}");
    let result = run_blocking(move || {
        manager.sftp_upload(
            &session_id,
            &local,
            &remote,
            Some(&app),
            transfer_id.as_deref(),
        )
    })
    .await;
    record_operation(
        &state.storage,
        "sftp",
        &log_session,
        "upload",
        Some(&detail),
        &result,
    );
    result
}

#[tauri::command]
#[specta::specta]
pub async fn sftp_exists(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> AppResult<bool> {
    let manager = state.manager.clone();
    run_blocking(move || manager.sftp_exists(&session_id, &path)).await
}

#[tauri::command]
#[specta::specta]
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
    let log_session = session_id.clone();
    let detail = format!("{local_dir} → {remote_parent}/{remote_name}");
    let result = run_blocking(move || {
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
    .await;
    record_operation(
        &state.storage,
        "sftp",
        &log_session,
        "upload_dir",
        Some(&detail),
        &result,
    );
    result
}

#[tauri::command]
#[specta::specta]
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
    let log_session = session_id.clone();
    let detail = format!("{remote_dir} → {local_dir}");
    let result = run_blocking(move || {
        manager.sftp_download_dir(
            &session_id,
            &remote_dir,
            &local_dir,
            DirectoryTransferMode::parse(transfer_mode.as_deref()),
            Some(&app),
            transfer_id.as_deref(),
        )
    })
    .await;
    record_operation(
        &state.storage,
        "sftp",
        &log_session,
        "download_dir",
        Some(&detail),
        &result,
    );
    result
}

#[tauri::command]
#[specta::specta]
pub fn sftp_cancel_transfer(state: State<AppState>, transfer_id: String) -> AppResult<()> {
    state.manager.cancel_transfer(&transfer_id);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn sftp_pause_transfer(state: State<AppState>, transfer_id: String) -> AppResult<()> {
    state.manager.pause_transfer(&transfer_id)
}

#[tauri::command]
#[specta::specta]
pub fn sftp_resume_transfer(state: State<AppState>, transfer_id: String) -> AppResult<()> {
    state.manager.resume_transfer(&transfer_id)
}

#[tauri::command]
#[specta::specta]
pub fn sftp_reset_connection(state: State<AppState>, session_id: String) -> AppResult<()> {
    state.manager.reset_sftp_conn(&session_id);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn sftp_extract(
    state: State<'_, AppState>,
    session_id: String,
    remote_archive: String,
    remote_parent: String,
    out_name: Option<String>,
) -> AppResult<()> {
    let manager = state.manager.clone();
    let log_session = session_id.clone();
    let detail = format!("{remote_archive} → {remote_parent}");
    let result = run_blocking(move || {
        manager.sftp_extract(
            &session_id,
            &remote_archive,
            &remote_parent,
            out_name.as_deref(),
        )
    })
    .await;
    record_operation(
        &state.storage,
        "sftp",
        &log_session,
        "extract",
        Some(&detail),
        &result,
    );
    result
}
