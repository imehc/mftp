use super::activity::{ActivitySink, OperationContext};
use super::operations::{MaintenanceLease, Operations};
use crate::error::{AppError, AppResult};
use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

#[derive(Clone)]
pub(crate) struct Executor {
    activity: Arc<dyn ActivitySink>,
    operations: Arc<Operations>,
}

impl Executor {
    pub(crate) async fn maintenance(&self) -> AppResult<MaintenanceLease> {
        // Bound the admission pause: a long transfer may need another command
        // to cancel it. Timeout rejects maintenance without starting deletion.
        self.operations.maintenance(Duration::from_secs(5)).await
    }

    pub(crate) fn new(activity: Arc<dyn ActivitySink>, operations: Arc<Operations>) -> Self {
        Self {
            activity,
            operations,
        }
    }

    /// Reads and log-management operations need admission without creating logs.
    /// Keep it with the real worker and any unclaimed resource-bearing result.
    pub(crate) async fn blocking_unlogged<T, F>(&self, operation: F) -> AppResult<T>
    where
        T: Send + 'static,
        F: FnOnce() -> AppResult<T> + Send + 'static,
    {
        run_blocking_guarded(self.operations.begin()?, operation).await
    }

    pub(crate) async fn blocking<T, F>(
        &self,
        context: OperationContext,
        operation: F,
    ) -> AppResult<T>
    where
        T: Send + 'static,
        F: FnOnce() -> AppResult<T> + Send + 'static,
    {
        let lease = self.operations.begin()?;
        let activity = self.activity.clone();
        run_blocking(move || {
            // The real worker owns admission until its operation and log finish,
            // even when the command future is dropped while it is queued/running.
            let _lease = lease;
            let result = operation();
            record(activity.as_ref(), &context, &result);
            result
        })
        .await
    }

    pub(crate) async fn asynchronous<T, F>(
        &self,
        context: OperationContext,
        operation: F,
    ) -> AppResult<T>
    where
        T: Send + 'static,
        F: Future<Output = AppResult<T>>,
    {
        // This lease covers the supplied future. Detached domain workers need
        // their own lifetime guard; dropping the future does not stop them.
        let lease = self.operations.begin()?;
        let result = operation.await;
        let activity = self.activity.clone();
        // Only diagnostic data crosses into the database worker. The business
        // result stays here so a log/JoinError cannot turn success into failure.
        let error = result.as_ref().err().cloned();
        if let Err(error) = run_blocking(move || {
            let _lease = lease;
            activity.record(&context, error.as_ref())
        })
        .await
        {
            eprintln!("activity log failed: {}", error.code);
        }
        result
    }
}

fn record<T>(activity: &dyn ActivitySink, context: &OperationContext, result: &AppResult<T>) {
    // Diagnostics are outside the business transaction. Even a broken sink must
    // not make the caller retry a write that has already completed successfully.
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        activity.record(context, result.as_ref().err())
    })) {
        Ok(Ok(())) => {}
        Ok(Err(error)) => eprintln!("activity log failed: {}", error.code),
        Err(_) => eprintln!("activity log worker panicked"),
    }
}

/// Keep runtime join failures separate from the operation's unchanged payload.
pub(crate) async fn run_blocking<T, F>(operation: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> AppResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(AppError::from)?
}

/// Keep domain admission/completion with the real worker and any unclaimed
/// result. Result fields drop before the guard when an awaiter is cancelled.
pub(crate) async fn run_blocking_guarded<T, F, G>(guard: G, operation: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> AppResult<T> + Send + 'static,
    G: Send + 'static,
{
    let (result, _guard) = run_blocking(move || {
        let completion = guard;
        Ok((operation(), completion))
    })
    .await?;
    result
}

#[cfg(test)]
#[path = "execution_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "execution_maintenance_tests.rs"]
mod maintenance_tests;

#[cfg(test)]
#[path = "execution_unlogged_tests.rs"]
mod unlogged_tests;
