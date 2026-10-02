//! BT's platform-local event and system-file capabilities.

use crate::error::{AppError, AppResult};
use crate::modules::bt::{
    ports::{BtEvent, EventSink, FileAccess},
    repository::BtRepository,
    BtManager,
};
use crate::storage::Storage;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{Emitter, Manager};

pub(crate) fn install(app: &tauri::AppHandle, storage: Storage) -> Arc<BtManager> {
    // Storage was initialized from this platform's app_data_dir during bootstrap.
    let base_dir = storage.root_path().join("bt");
    Arc::new(BtManager::new(
        BtRepository::new(storage),
        base_dir,
        event_sink(app),
        Arc::new(TauriFiles(app.clone())),
    ))
}

pub(crate) fn shutdown(manager: &BtManager) {
    // Lifecycle runs stop callbacks on dedicated threads. Keep the Tauri runtime
    // bridge here; the domain exposes an awaitable stop for its own resources.
    tauri::async_runtime::block_on(manager.shutdown());
}

fn event_sink<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> EventSink {
    let app = app.clone();
    Arc::new(move |event| {
        let _ = match event {
            BtEvent::Task(event) => app.emit(crate::transfer::BT_TASK_EVENT, event),
            BtEvent::Progress(progress) => {
                app.emit(crate::transfer::TRANSFER_PROGRESS_EVENT, progress)
            }
        };
    })
}

struct TauriFiles(tauri::AppHandle);

impl FileAccess for TauriFiles {
    fn download_dir(&self) -> AppResult<PathBuf> {
        // Resolve only for an export without an explicit destination. An unavailable
        // system directory must not prevent downloads or custom-directory exports.
        self.0.path().download_dir().map_err(AppError::from)
    }

    fn open(&self, path: &Path) -> AppResult<()> {
        // The existing opener grants Android content URIs without copying the file.
        crate::file_opener::open(&self.0, path)
    }
}

#[cfg(all(test, desktop))]
#[path = "bt_tests.rs"]
mod tests;
