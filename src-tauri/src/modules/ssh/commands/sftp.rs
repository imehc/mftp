use crate::app::services::AppServices;
use crate::core::activity::OperationContext;
use crate::core::execution::run_blocking_guarded;
use crate::error::AppResult;
use crate::modules::ssh::DirectoryTransferMode;
use crate::modules::ssh::{SftpEntry, SftpFileInfo};
use tauri::{AppHandle, State};

#[tauri::command]
#[specta::specta]
pub async fn sftp_home(state: State<'_, AppServices>, session_id: String) -> AppResult<String> {
    let manager = state.manager.clone();
    run_blocking_guarded(state.manager.operation()?, move || {
        manager.sftp_home(&session_id)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn sftp_start_dir(
    state: State<'_, AppServices>,
    session_id: String,
    preferred: Option<String>,
) -> AppResult<String> {
    let manager = state.manager.clone();
    run_blocking_guarded(state.manager.operation()?, move || {
        manager.sftp_start_dir(&session_id, preferred.as_deref())
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn sftp_list(
    state: State<'_, AppServices>,
    session_id: String,
    path: String,
) -> AppResult<Vec<SftpEntry>> {
    let manager = state.manager.clone();
    run_blocking_guarded(state.manager.operation()?, move || {
        manager.sftp_list(&session_id, &path)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn sftp_info(
    state: State<'_, AppServices>,
    session_id: String,
    path: String,
) -> AppResult<SftpFileInfo> {
    let manager = state.manager.clone();
    run_blocking_guarded(state.manager.operation()?, move || {
        manager.sftp_info(&session_id, &path)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn sftp_mkdir(
    state: State<'_, AppServices>,
    session_id: String,
    path: String,
) -> AppResult<()> {
    let manager = state.manager.clone();
    let context =
        OperationContext::new("sftp", "mkdir", session_id.clone()).with_detail(path.clone());
    super::blocking(&state, context, move || {
        manager.sftp_mkdir(&session_id, &path)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn sftp_rename(
    state: State<'_, AppServices>,
    session_id: String,
    from: String,
    to: String,
) -> AppResult<()> {
    let manager = state.manager.clone();
    let log_session = session_id.clone();
    let detail = format!("{from} → {to}");
    let context = OperationContext::new("sftp", "rename", log_session).with_detail(detail);
    super::blocking(&state, context, move || {
        manager.sftp_rename(&session_id, &from, &to)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn sftp_delete(
    app: AppHandle,
    state: State<'_, AppServices>,
    session_id: String,
    path: String,
    is_dir: bool,
    transfer_id: Option<String>,
) -> AppResult<()> {
    let events = crate::adapters::ssh::event_sink(&app);
    let manager = state.manager.clone();
    let log_session = session_id.clone();
    let log_path = path.clone();
    let context = OperationContext::new("sftp", "delete", log_session).with_detail(log_path);
    super::blocking(&state, context, move || {
        manager.sftp_delete(
            &session_id,
            &path,
            is_dir,
            Some(&events),
            transfer_id.as_deref(),
        )
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn sftp_download(
    app: AppHandle,
    state: State<'_, AppServices>,
    session_id: String,
    remote: String,
    local: String,
    transfer_id: Option<String>,
) -> AppResult<()> {
    let events = crate::adapters::ssh::event_sink(&app);
    let manager = state.manager.clone();
    let log_session = session_id.clone();
    let detail = format!("{remote} → {local}");
    let context = OperationContext::new("sftp", "download", log_session).with_detail(detail);
    super::blocking(&state, context, move || {
        manager.sftp_download(
            &session_id,
            &remote,
            &local,
            Some(&events),
            transfer_id.as_deref(),
        )
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn sftp_upload(
    app: AppHandle,
    state: State<'_, AppServices>,
    session_id: String,
    local: String,
    remote: String,
    transfer_id: Option<String>,
) -> AppResult<()> {
    let events = crate::adapters::ssh::event_sink(&app);
    let manager = state.manager.clone();
    let log_session = session_id.clone();
    let detail = format!("{local} → {remote}");
    let context = OperationContext::new("sftp", "upload", log_session).with_detail(detail);
    super::blocking(&state, context, move || {
        manager.sftp_upload(
            &session_id,
            &local,
            &remote,
            Some(&events),
            transfer_id.as_deref(),
        )
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn sftp_exists(
    state: State<'_, AppServices>,
    session_id: String,
    path: String,
) -> AppResult<bool> {
    let manager = state.manager.clone();
    run_blocking_guarded(state.manager.operation()?, move || {
        manager.sftp_exists(&session_id, &path)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn sftp_upload_dir(
    app: AppHandle,
    state: State<'_, AppServices>,
    session_id: String,
    local_dir: String,
    remote_parent: String,
    remote_name: String,
    transfer_mode: Option<String>,
    transfer_id: Option<String>,
) -> AppResult<()> {
    let events = crate::adapters::ssh::event_sink(&app);
    let manager = state.manager.clone();
    let log_session = session_id.clone();
    let detail = format!("{local_dir} → {remote_parent}/{remote_name}");
    let context = OperationContext::new("sftp", "upload_dir", log_session).with_detail(detail);
    super::blocking(&state, context, move || {
        manager.sftp_upload_dir(
            &session_id,
            &local_dir,
            &remote_parent,
            &remote_name,
            DirectoryTransferMode::parse(transfer_mode.as_deref()),
            Some(&events),
            transfer_id.as_deref(),
        )
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn sftp_download_dir(
    app: AppHandle,
    state: State<'_, AppServices>,
    session_id: String,
    remote_dir: String,
    local_dir: String,
    transfer_mode: Option<String>,
    transfer_id: Option<String>,
) -> AppResult<()> {
    let events = crate::adapters::ssh::event_sink(&app);
    let manager = state.manager.clone();
    let log_session = session_id.clone();
    let detail = format!("{remote_dir} → {local_dir}");
    let context = OperationContext::new("sftp", "download_dir", log_session).with_detail(detail);
    super::blocking(&state, context, move || {
        manager.sftp_download_dir(
            &session_id,
            &remote_dir,
            &local_dir,
            DirectoryTransferMode::parse(transfer_mode.as_deref()),
            Some(&events),
            transfer_id.as_deref(),
        )
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn sftp_cancel_transfer(
    state: State<'_, AppServices>,
    transfer_id: String,
) -> AppResult<()> {
    let manager = state.manager.clone();
    let log_transfer = transfer_id.clone();
    let context = OperationContext::new("sftp", "cancel_transfer", log_transfer);
    super::blocking(&state, context, move || {
        manager.cancel_transfer(&transfer_id);
        Ok(())
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn sftp_pause_transfer(
    state: State<'_, AppServices>,
    transfer_id: String,
) -> AppResult<()> {
    let manager = state.manager.clone();
    let log_transfer = transfer_id.clone();
    let context = OperationContext::new("sftp", "pause_transfer", log_transfer);
    super::blocking(&state, context, move || {
        manager.pause_transfer(&transfer_id)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn sftp_resume_transfer(
    state: State<'_, AppServices>,
    transfer_id: String,
) -> AppResult<()> {
    let manager = state.manager.clone();
    let log_transfer = transfer_id.clone();
    let context = OperationContext::new("sftp", "resume_transfer", log_transfer);
    super::blocking(&state, context, move || {
        manager.resume_transfer(&transfer_id)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn sftp_reset_connection(
    state: State<'_, AppServices>,
    session_id: String,
) -> AppResult<()> {
    let manager = state.manager.clone();
    let log_session = session_id.clone();
    let context = OperationContext::new("sftp", "reset_connection", log_session);
    super::blocking(&state, context, move || {
        manager.reset_sftp_conn(&session_id);
        Ok(())
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn sftp_extract(
    state: State<'_, AppServices>,
    session_id: String,
    remote_archive: String,
    remote_parent: String,
    out_name: Option<String>,
) -> AppResult<()> {
    let manager = state.manager.clone();
    let log_session = session_id.clone();
    let detail = format!("{remote_archive} → {remote_parent}");
    let context = OperationContext::new("sftp", "extract", log_session).with_detail(detail);
    super::blocking(&state, context, move || {
        manager.sftp_extract(
            &session_id,
            &remote_archive,
            &remote_parent,
            out_name.as_deref(),
        )
    })
    .await
}
