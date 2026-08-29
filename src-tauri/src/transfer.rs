//! Single outlet for transfer progress events. SFTP and BT share the same
//! event topic and payload; the frontend transfer panel listens to this
//! channel only (TRANSFER_PROGRESS in src/lib/events.ts).

use tauri::{AppHandle, Emitter};

use crate::models::TransferProgress;

/// Wire name kept from history (predates the scheme:// convention); both
/// sides derive from this constant — never change it unilaterally.
pub const TRANSFER_PROGRESS_EVENT: &str = "sftp-transfer-progress";

/// BT task-level events (save-to-local done/failed). Payload: `bt::BtTaskEvent`.
pub const BT_TASK_EVENT: &str = "bt://task-event";

pub(crate) fn emit_transfer_progress(
    app: Option<&AppHandle>,
    transfer_id: Option<&str>,
    phase: &str,
    transferred: u64,
    total: Option<u64>,
) {
    let (Some(app), Some(id)) = (app, transfer_id) else {
        return;
    };
    emit(
        app,
        TransferProgress {
            id: id.to_string(),
            phase: phase.to_string(),
            transferred,
            total,
            finished: None,
        },
    );
}

/// Used by engine-managed tasks (BT): carries the finished flag on
/// completion so the frontend can flip the task to success (for SFTP the
/// completion state is driven by the command return value).
pub(crate) fn emit_transfer_progress_with_finish(
    app: &AppHandle,
    transfer_id: &str,
    phase: &str,
    transferred: u64,
    total: Option<u64>,
    finished: bool,
) {
    emit(
        app,
        TransferProgress {
            id: transfer_id.to_string(),
            phase: phase.to_string(),
            transferred,
            total,
            finished: Some(finished),
        },
    );
}

fn emit(app: &AppHandle, progress: TransferProgress) {
    let _ = app.emit(TRANSFER_PROGRESS_EVENT, progress);
}
