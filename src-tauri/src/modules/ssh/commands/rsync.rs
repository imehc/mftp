use crate::app::services::AppServices;
use crate::core::activity::OperationContext;
use crate::error::AppResult;
use crate::modules::ssh::{
    RsyncCapabilities, RsyncDirection, RsyncPreview, RsyncToolStatus, RsyncTransferResult,
};
use tauri::{AppHandle, State};

#[tauri::command]
#[specta::specta]
pub async fn rsync_local_status(
    state: State<'_, AppServices>,
    refresh: bool,
) -> AppResult<RsyncToolStatus> {
    let manager = state.manager.clone();
    super::reading(&state, "local", "rsync_local_status", move || {
        Ok(manager.rsync_local_status(refresh))
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn rsync_capabilities(
    state: State<'_, AppServices>,
    session_id: String,
    refresh: bool,
) -> AppResult<RsyncCapabilities> {
    let manager = state.manager.clone();
    let log_session = session_id.clone();
    super::reading(&state, &log_session, "rsync_capabilities", move || {
        manager.rsync_capabilities(&session_id, refresh)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn rsync_preview(
    state: State<'_, AppServices>,
    session_id: String,
    direction: RsyncDirection,
    local_dir: String,
    remote_dir: String,
    delete_extraneous: bool,
) -> AppResult<RsyncPreview> {
    let manager = state.manager.clone();
    let log_session = session_id.clone();
    let detail = format!("{local_dir} ⇄ {remote_dir}");
    let context = OperationContext::new("sftp", "rsync_preview", log_session).with_detail(detail);
    super::blocking(&state, context, None, move || {
        manager.rsync_preview(
            &session_id,
            direction,
            &local_dir,
            &remote_dir,
            delete_extraneous,
        )
    })
    .await
}

#[tauri::command]
#[specta::specta]
#[expect(
    clippy::too_many_arguments,
    reason = "Tauri injects app and state; the token and snapshot must be rechecked"
)]
pub async fn rsync_transfer(
    app: AppHandle,
    state: State<'_, AppServices>,
    session_id: String,
    token: String,
    direction: RsyncDirection,
    local_dir: String,
    remote_dir: String,
    delete_extraneous: bool,
    transfer_id: Option<String>,
) -> AppResult<RsyncTransferResult> {
    let events = crate::adapters::ssh::event_sink(&app);
    let manager = state.manager.clone();
    let log_session = session_id.clone();
    let detail = format!("{local_dir} ⇄ {remote_dir}");
    let context = OperationContext::new("sftp", "rsync_transfer", log_session).with_detail(detail);
    super::blocking(&state, context, transfer_id.clone().as_deref(), move || {
        manager.rsync_transfer(
            &session_id,
            &token,
            direction,
            &local_dir,
            &remote_dir,
            delete_extraneous,
            Some(&events),
            transfer_id.as_deref(),
        )
    })
    .await
}
