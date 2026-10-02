use super::shell_lifecycle::ShellHandle;
use super::types::Manager;
use crate::core::operations::{MaintenanceLease, OperationLease};
use crate::error::AppResult;
use std::sync::Arc;
use std::time::Duration;

/// Composite exclusion over both leased counters: command workers and detached
/// shell threads. Clear/reset must hold it until its real deletion work ends;
/// draining only `operations` would let an already-started shell keep writing
/// cleanup artifacts after the busy check passed.
pub(crate) struct ManagerMaintenance {
    _operations: MaintenanceLease,
    _workers: MaintenanceLease,
}

impl Manager {
    /// Commands move this lease into their real worker, including cleanup.
    /// Shell threads retain a separate lease after the open command returns.
    pub(crate) fn operation(&self) -> AppResult<OperationLease> {
        self.operations.begin()
    }

    pub(crate) async fn maintenance(&self) -> AppResult<ManagerMaintenance> {
        let operations = self.operations.maintenance(Duration::from_secs(5)).await?;
        // Shell worker leases outlive their open command, so they need a
        // separate drain; reserving admission also fails late open_shell
        // reservations fast instead of letting them race the reset.
        let workers = self.workers.maintenance(Duration::from_secs(5)).await?;
        Ok(ManagerMaintenance {
            _operations: operations,
            _workers: workers,
        })
    }

    pub fn shutdown_all(&self) {
        self.operations.close();
        self.workers.close();
        self.cancel_all_transfers();
        // Snapshot before signalling: closing a handle can block, and a shell
        // worker's completion removal needs the same shells lock.
        let shells: Vec<Arc<ShellHandle>> = self.shells.lock().values().cloned().collect();
        for shell in shells {
            shell.close();
        }

        // Keep authentication/cache available to in-flight cleanup. No temp
        // path may be removed until its owning command and shell have ended.
        // The app coordinator reports this participant unfinished on timeout.
        self.operations.wait_until_idle();
        self.workers.wait_until_idle();
        self.auth.lock().clear();
        self.sftp.lock().clear();
        self.monitor.lock().clear();
        self.transfers.lock().clear();
        let _ = self.cleanup_local_temps();
    }
}

#[cfg(test)]
#[path = "admission_tests.rs"]
mod tests;
