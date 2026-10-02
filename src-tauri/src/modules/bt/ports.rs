//! Typed outbound capabilities. Domain code never needs a Tauri application handle.

use super::BtTaskEvent;
use crate::error::AppResult;
use crate::models::TransferProgress;
use std::path::{Path, PathBuf};
use std::sync::Arc;

pub(crate) enum BtEvent {
    Task(BtTaskEvent),
    Progress(TransferProgress),
}

// Notifications are best-effort; persisted task state remains the recovery source.
pub(crate) type EventSink = Arc<dyn Fn(BtEvent) + Send + Sync>;

pub(crate) trait FileAccess: Send + Sync {
    fn download_dir(&self) -> AppResult<PathBuf>;
    fn open(&self, path: &Path) -> AppResult<()>;
}

pub(super) fn emit_task(events: &EventSink, event: BtTaskEvent) {
    events(BtEvent::Task(event));
}

pub(super) fn emit_progress(
    events: &EventSink,
    transfer_id: &str,
    phase: &str,
    transferred: u64,
    total: Option<u64>,
    finished: bool,
) {
    events(BtEvent::Progress(TransferProgress {
        id: transfer_id.to_owned(),
        phase: phase.to_owned(),
        transferred,
        total,
        finished: Some(finished),
    }));
}
