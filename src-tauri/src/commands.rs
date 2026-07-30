use crate::error::{AppError, AppResult};
use crate::storage::Storage;

mod export;
mod game_room;
mod hosts;
mod keys;
mod lan_transfer;
mod sftp;
mod ssh;
mod vault;

pub use export::*;
pub use game_room::*;
pub use hosts::*;
pub use keys::*;
pub use lan_transfer::*;
pub use sftp::*;
pub use ssh::*;
pub use vault::*;

pub(crate) async fn run_blocking<T, F>(f: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> AppResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError(format!("background task failed: {e}")))?
}

pub(crate) fn record_operation<T>(
    storage: &Storage,
    source: &str,
    address: &str,
    action: &str,
    detail: Option<&str>,
    result: &AppResult<T>,
) {
    let (status, error_detail) = match result {
        Ok(_) => ("success", None),
        Err(error) => ("failed", Some(error.0.as_str())),
    };
    let _ = storage.record_activity_log(source, address, action, status, error_detail.or(detail));
}
