use crate::error::{AppError, AppResult, CustomErrorCode};
use parking_lot::{Condvar, Mutex};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Notify;

#[derive(Default)]
struct State {
    closed: bool,
    maintenance: bool,
    active: usize,
}

impl State {
    fn check_admission(&self) -> AppResult<()> {
        if self.closed {
            Err(AppError::custom(CustomErrorCode::AppShuttingDown))
        } else if self.maintenance {
            Err(AppError::custom(CustomErrorCode::AppMaintenanceInProgress))
        } else {
            Ok(())
        }
    }
}

/// Counts explicitly leased work and maintenance. Detached workers need their
/// own lease; admission alone is never evidence that domain IO has stopped.
#[derive(Default)]
pub(crate) struct Operations {
    state: Mutex<State>,
    idle: Condvar,
    changed: Notify,
}

impl Operations {
    pub(crate) fn begin(self: &Arc<Self>) -> AppResult<OperationLease> {
        let mut state = self.state.lock();
        state.check_admission()?;
        state.active += 1;
        Ok(OperationLease(self.clone()))
    }

    pub(crate) fn is_closed(&self) -> bool {
        self.state.lock().closed
    }

    pub(crate) fn close(&self) {
        self.state.lock().closed = true;
        self.changed.notify_waiters();
    }

    /// The IPC gate is an early rejection only; workers must acquire a lease.
    pub(crate) fn check_admission(&self) -> AppResult<()> {
        self.state.lock().check_admission()
    }

    /// Reserve before draining so new workers cannot starve maintenance.
    /// Acquire this before any domain-exclusive guards to avoid lock inversion.
    pub(crate) async fn maintenance(
        self: &Arc<Self>,
        timeout: Duration,
    ) -> AppResult<MaintenanceLease> {
        let lease = {
            let mut state = self.state.lock();
            state.check_admission()?;
            state.maintenance = true;
            MaintenanceLease(self.clone())
        };
        // Dropping this future (including timeout/shutdown) releases only the
        // reservation. Existing workers retain their individual leases.
        tokio::time::timeout(timeout, async {
            loop {
                let changed = self.changed.notified();
                tokio::pin!(changed);
                // Register before checking the predicate to avoid a lost wakeup.
                changed.as_mut().enable();
                {
                    let state = self.state.lock();
                    if state.closed {
                        return Err(AppError::custom(CustomErrorCode::AppShuttingDown));
                    }
                    if state.active == 0 {
                        return Ok(());
                    }
                }
                changed.await;
            }
        })
        .await
        .map_err(|_| AppError::custom(CustomErrorCode::AppOperationsBusy))??;
        Ok(lease)
    }

    /// Domain stop callbacks use the application lifecycle's outer deadline.
    /// Returning early here would falsely report a still-running worker as stopped.
    pub(crate) fn wait_until_idle(&self) {
        let mut state = self.state.lock();
        while state.active != 0 || state.maintenance {
            self.idle.wait(&mut state);
        }
    }

    /// Only call from a blocking thread. Blocking workers retain their own lease.
    pub(crate) fn wait_idle(&self, timeout: Duration) -> bool {
        let deadline = std::time::Instant::now() + timeout;
        let mut state = self.state.lock();
        while state.active != 0 || state.maintenance {
            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            if remaining.is_zero() {
                return false;
            }
            self.idle.wait_for(&mut state, remaining);
        }
        true
    }
}

pub(crate) struct OperationLease(Arc<Operations>);

impl Drop for OperationLease {
    fn drop(&mut self) {
        let mut state = self.0.state.lock();
        state.active -= 1;
        if state.active == 0 {
            self.0.idle.notify_all();
            self.0.changed.notify_waiters();
        }
    }
}

/// Move into the actual deletion worker; dropping an IPC waiter is not completion.
pub(crate) struct MaintenanceLease(Arc<Operations>);

impl Drop for MaintenanceLease {
    fn drop(&mut self) {
        let mut state = self.0.state.lock();
        // Permanent shutdown is independent and must never be reopened here.
        state.maintenance = false;
        self.0.idle.notify_all();
    }
}

#[cfg(test)]
#[path = "operations_tests.rs"]
mod tests;
