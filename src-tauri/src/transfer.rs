//! Single outlet for transfer progress events. SFTP and BT share the same
//! event topic and payload; the frontend transfer panel listens to this
//! channel only (TRANSFER_PROGRESS in src/lib/events.ts).

/// Wire name kept from history (predates the scheme:// convention); both
/// sides derive from this constant — never change it unilaterally.
pub const TRANSFER_PROGRESS_EVENT: &str = "sftp-transfer-progress";

/// BT task-level events (save-to-local done/failed). Payload: `modules::bt::BtTaskEvent`.
#[cfg(any(desktop, target_os = "android"))]
pub const BT_TASK_EVENT: &str = "bt://task-event";
