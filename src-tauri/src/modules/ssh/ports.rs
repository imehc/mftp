use crate::models::TransferProgress;
use std::sync::Arc;

pub(crate) enum SshEvent<'a> {
    Data {
        session_id: &'a str,
        bytes: &'a [u8],
    },
    Closed {
        session_id: &'a str,
    },
    Progress(TransferProgress),
}

// The adapter consumes borrowed terminal bytes synchronously. Encoding stays
// at the IPC boundary without adding a second buffer or JSON envelope.
pub(crate) type EventSink = Arc<dyn for<'a> Fn(SshEvent<'a>) + Send + Sync>;

pub(super) fn emit_progress(
    events: Option<&EventSink>,
    transfer_id: Option<&str>,
    phase: &str,
    transferred: u64,
    total: Option<u64>,
) {
    let (Some(events), Some(id)) = (events, transfer_id) else {
        return;
    };
    events(SshEvent::Progress(TransferProgress {
        id: id.to_owned(),
        phase: phase.to_owned(),
        transferred,
        total,
        // SFTP completion still comes from the command result.
        finished: None,
    }));
}
