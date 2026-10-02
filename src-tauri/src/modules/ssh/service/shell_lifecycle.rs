use super::types::ShellJob;
use crate::core::operations::OperationLease;
use crate::error::{AppError, AppResult, CustomErrorCode};
use parking_lot::{Condvar, Mutex};
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc::Sender,
    Arc,
};

pub(super) type Shells = Arc<Mutex<HashMap<String, Arc<ShellHandle>>>>;

struct ShellStatus {
    started: bool,
    finished: bool,
}

pub(super) struct ShellHandle {
    pub(super) tx: Sender<ShellJob>,
    closing: AtomicBool,
    status: Mutex<ShellStatus>,
    changed: Condvar,
}

impl ShellHandle {
    pub(super) fn new(tx: Sender<ShellJob>) -> Self {
        Self {
            tx,
            closing: AtomicBool::new(false),
            status: Mutex::new(ShellStatus {
                started: false,
                finished: false,
            }),
            changed: Condvar::new(),
        }
    }

    pub(super) fn close(&self) {
        let _status = self.status.lock();
        // Prioritize stop over a backlog of terminal writes.
        self.closing.store(true, Ordering::SeqCst);
        let _ = self.tx.send(ShellJob::Close);
        self.changed.notify_all();
    }

    pub(super) fn is_closing(&self) -> bool {
        self.closing.load(Ordering::SeqCst)
    }

    pub(super) fn started(&self) {
        self.status.lock().started = true;
        self.changed.notify_all();
    }

    pub(super) fn wait_started(&self) -> AppResult<()> {
        let mut status = self.status.lock();
        while !status.started && !status.finished && !self.is_closing() {
            self.changed.wait(&mut status);
        }
        if status.finished || self.is_closing() {
            Err(AppError::custom(CustomErrorCode::SshShellClosed))
        } else {
            Ok(())
        }
    }

    pub(super) fn wait(&self) {
        let mut status = self.status.lock();
        while !status.finished {
            self.changed.wait(&mut status);
        }
    }
}

/// Created before connection setup and moved into the spawned thread. Spawn
/// failure, early return and unwinding all release the same reservation.
pub(super) struct ShellCompletion {
    pub(super) shells: Shells,
    pub(super) id: String,
    pub(super) handle: Arc<ShellHandle>,
    pub(super) _lease: OperationLease,
}

impl Drop for ShellCompletion {
    fn drop(&mut self) {
        let mut shells = self.shells.lock();
        if shells
            .get(&self.id)
            .is_some_and(|current| Arc::ptr_eq(current, &self.handle))
        {
            shells.remove(&self.id);
        }
        self.handle.status.lock().finished = true;
        self.handle.changed.notify_all();
    }
}

#[cfg(test)]
#[path = "shell_lifecycle_tests.rs"]
mod tests;
