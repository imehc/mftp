//! Poetry IPC commands. Thin shells: routing, service calls, Executor
//! logging and progress event emission only; business logic lives in the
//! domain directories and `service/`.

mod library;
mod sync;
mod translations;

pub use library::*;
pub use sync::*;
pub use translations::*;

use tauri::{AppHandle, Emitter};

use crate::modules::poetry::model::PoetrySyncProgress;
use crate::modules::poetry::sync::SYNC_PROGRESS_EVENT;

pub(super) fn progress_emitter(
    app: &AppHandle,
) -> impl Fn(PoetrySyncProgress) + Send + Sync + 'static {
    let app = app.clone();
    move |progress| {
        let _ = app.emit(SYNC_PROGRESS_EVENT, progress);
    }
}
