use crate::core::activity::{ActivitySink, OperationContext};
use crate::error::{AppError, AppResult};
use crate::storage::Storage;

pub(crate) struct StorageActivityLog(pub Storage);

impl ActivitySink for StorageActivityLog {
    fn record(&self, context: &OperationContext, error: Option<&AppError>) -> AppResult<()> {
        write_result(
            &self.0,
            context.source,
            &context.address,
            context.action,
            context.detail.as_deref(),
            error,
        )
    }
}

fn write_result(
    storage: &Storage,
    source: &str,
    address: &str,
    action: &str,
    detail: Option<&str>,
    error: Option<&AppError>,
) -> AppResult<()> {
    // `detail` is business metadata only; the failure keeps its full
    // { kind, code, message, args } in the versioned error payload column.
    storage.record_result(source, address, action, detail, error)
}

#[cfg(test)]
#[path = "activity_log_tests.rs"]
mod tests;
