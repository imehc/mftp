mod sftp;
mod ssh;

pub use sftp::*;
pub use ssh::*;

use crate::app::services::AppServices;
use crate::core::activity::OperationContext;
use crate::error::AppResult;

async fn blocking<T, F>(
    state: &AppServices,
    context: OperationContext,
    operation: F,
) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> AppResult<T> + Send + 'static,
{
    let lease = state.manager.operation()?;
    state
        .executor
        .blocking(context, move || {
            // Domain cleanup follows the real worker; the shared executor also
            // retains its own lease through the subsequent activity-log write.
            let _lease = lease;
            operation()
        })
        .await
}
