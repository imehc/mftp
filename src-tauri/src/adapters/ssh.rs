use crate::modules::ssh::ports::{EventSink, SshEvent};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::sync::Arc;
use tauri::Emitter;

pub(crate) fn event_sink<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> EventSink {
    let app = app.clone();
    Arc::new(move |event| {
        // Preserve the historical per-session topics and string payloads.
        let result = match event {
            SshEvent::Data { session_id, bytes } => {
                app.emit(&format!("ssh://data/{session_id}"), STANDARD.encode(bytes))
            }
            SshEvent::Closed { session_id } => {
                app.emit(&format!("ssh://closed/{session_id}"), session_id)
            }
            SshEvent::Progress(progress) => {
                app.emit(crate::transfer::TRANSFER_PROGRESS_EVENT, progress)
            }
        };
        if let Err(error) = result {
            eprintln!(
                "SSH event delivery failed: {}",
                crate::error::AppError::from(error).code
            );
        }
    })
}

#[cfg(all(test, desktop))]
#[path = "ssh_tests.rs"]
mod tests;
