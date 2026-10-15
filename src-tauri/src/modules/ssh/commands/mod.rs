mod sftp;
mod ssh;

pub use sftp::*;
pub use ssh::*;

use crate::app::services::AppServices;
use crate::core::activity::OperationContext;
use crate::error::AppResult;

async fn blocking<T, F>(
    state: &AppServices,
    mut context: OperationContext,
    transfer_id: Option<&str>,
    operation: F,
) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> AppResult<T> + Send + 'static,
{
    let lease = state.manager.operation()?;
    let redactor = state.manager.error_redactor(&context.address);
    let (log, transfer_log) = state.manager.diagnostic(&context, transfer_id);
    context.operation_id = log.as_ref().map(|log| log.id().to_string());
    context.address = redactor.text(&context.address).0;
    context.detail = context.detail.map(|detail| redactor.text(&detail).0);
    state
        .executor
        .blocking_diagnostic(context, log, move || {
            // Domain cleanup follows the real worker; the shared executor also
            // retains its own lease through the subsequent activity-log write.
            let _lease = lease;
            let _transfer_log = transfer_log;
            operation().map_err(|error| redactor.error(error))
        })
        .await
}

async fn reading<T, F>(
    state: &AppServices,
    session_id: &str,
    action: &'static str,
    operation: F,
) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> AppResult<T> + Send + 'static,
{
    let lease = state.manager.operation()?;
    let redactor = state.manager.error_redactor(session_id);
    let source = if action.starts_with("ssh_") {
        "ssh"
    } else {
        "sftp"
    };
    let (log, _) = state
        .manager
        .diagnostic(&OperationContext::new(source, action, session_id), None);
    crate::core::execution::run_blocking_guarded(lease, move || {
        crate::core::diagnostics::context::run(log, || {
            operation().map_err(|error| redactor.error(error))
        })
    })
    .await
}
