use crate::error::{AppError, AppResult};

mod hosts;
mod keys;
mod sftp;
mod ssh;

pub use hosts::*;
pub use keys::*;
pub use sftp::*;
pub use ssh::*;

pub(crate) async fn run_blocking<T, F>(f: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> AppResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError(format!("background task failed: {e}")))?
}
