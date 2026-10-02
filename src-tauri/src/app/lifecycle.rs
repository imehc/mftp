use crate::core::operations::Operations;
use crate::error::{AppError, AppResult, CustomErrorCode};
use crate::modules::maintenance::participants;
use parking_lot::Mutex;
use std::collections::BTreeMap;
use std::sync::{
    atomic::{AtomicU8, Ordering},
    mpsc, Arc,
};
use std::time::{Duration, Instant};

const RUNNING: u8 = 0;
const STOPPING: u8 = 1;
const FINISHED: u8 = 2;

type BusyCheck = Arc<dyn Fn() -> AppResult<bool> + Send + Sync>;

struct Participant {
    name: &'static str,
    stop: Box<dyn FnOnce() + Send>,
    busy: BusyCheck,
}

/// Owns participant registrations (exit stop callbacks + maintenance busy
/// checks). Domain calls still use concrete services.
pub(crate) struct Lifecycle {
    phase: AtomicU8,
    participants: Mutex<Vec<Participant>>,
    operations: Arc<Operations>,
}

#[derive(Debug)]
/// Reports stop-callback completion, not domain-worker quiescence. Managers
/// must add their own completion tracking as their lifecycle is migrated.
pub(crate) struct ShutdownReport {
    pub unfinished: Vec<&'static str>,
    pub operations_idle: bool,
}

impl ShutdownReport {
    pub(crate) fn completed(&self) -> bool {
        self.unfinished.is_empty() && self.operations_idle
    }
}

impl Lifecycle {
    pub(crate) fn new(operations: Arc<Operations>) -> Self {
        Self {
            phase: AtomicU8::new(RUNNING),
            participants: Mutex::new(Vec::new()),
            operations,
        }
    }

    /// Registration happens with service construction, before state is shared.
    /// One registration serves both coordination paths: `stop` reclaims the
    /// resource on the exit path, `busy` answers maintenance admission for the
    /// same stable participant id, so the two lists cannot drift apart.
    pub(crate) fn install<T: Send + Sync + 'static>(
        &mut self,
        name: &'static str,
        service: Arc<T>,
        stop: fn(&T),
        busy: fn(&T) -> AppResult<bool>,
    ) -> Arc<T> {
        let stop_service = service.clone();
        let busy_service = service.clone();
        self.participants.get_mut().push(Participant {
            name,
            stop: Box::new(move || stop(&stop_service)),
            busy: Arc::new(move || busy(&busy_service)),
        });
        service
    }

    /// Participant ids in registration order, shared by the shutdown report
    /// and the maintenance admission list.
    pub(crate) fn participant_ids(&self) -> Vec<&'static str> {
        self.participants
            .lock()
            .iter()
            .map(|item| item.name)
            .collect()
    }

    /// Maintenance admission: consult the capabilities the exit path
    /// registered. Domain checks run outside the registration lock.
    pub(crate) fn ensure_no_busy(&self, ids: &[&'static str]) -> AppResult<()> {
        let checks: Vec<(&'static str, BusyCheck)> = self
            .participants
            .lock()
            .iter()
            .filter(|item| ids.contains(&item.name))
            .map(|item| (item.name, item.busy.clone()))
            .collect();
        for id in ids {
            // A participant that cannot be queried cannot be proven quiescent
            // either: reject it as busy instead of silently skipping the check.
            if !checks.iter().any(|(name, _)| name == id) {
                return Err(participants::busy_error(id));
            }
        }
        for (name, check) in checks {
            if check()? {
                return Err(participants::busy_error(name));
            }
        }
        Ok(())
    }

    pub(crate) fn begin_shutdown(&self) -> bool {
        if self
            .phase
            .compare_exchange(RUNNING, STOPPING, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return false;
        }
        self.operations.close();
        true
    }

    pub(crate) fn check_admission(&self) -> AppResult<()> {
        if self.phase.load(Ordering::SeqCst) != RUNNING {
            return Err(AppError::custom(CustomErrorCode::AppShuttingDown));
        }
        self.operations.check_admission()
    }

    pub(crate) fn is_finished(&self) -> bool {
        self.phase.load(Ordering::SeqCst) == FINISHED
    }

    pub(crate) fn finish_shutdown(&self) {
        self.phase.store(FINISHED, Ordering::SeqCst);
    }

    /// Run off the UI/runtime threads. One stalled manager must not prevent
    /// other managers receiving their stop request or block application exit.
    pub(crate) fn shutdown_blocking(&self, timeout: Duration) -> ShutdownReport {
        let deadline = Instant::now() + timeout;
        let participants = std::mem::take(&mut *self.participants.lock());
        let mut pending: BTreeMap<_, _> = participants
            .iter()
            .enumerate()
            .map(|(id, item)| (id, item.name))
            .collect();
        let (tx, rx) = mpsc::channel();
        for (id, participant) in participants.into_iter().enumerate() {
            let tx = tx.clone();
            let name = participant.name;
            if let Err(error) = std::thread::Builder::new()
                .name(format!("stop-{name}"))
                .spawn(move || {
                    (participant.stop)();
                    let _ = tx.send(id);
                })
            {
                eprintln!("failed to start shutdown worker for {name}: {error}");
            }
        }
        drop(tx);
        while !pending.is_empty() {
            match rx.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
                Ok(id) => {
                    pending.remove(&id);
                }
                Err(_) => break,
            }
        }
        let operations_idle = self
            .operations
            .wait_idle(deadline.saturating_duration_since(Instant::now()));
        ShutdownReport {
            unfinished: pending.into_values().collect(),
            operations_idle,
        }
    }
}

impl Drop for Lifecycle {
    fn drop(&mut self) {
        // If installation aborts before the run loop, undo installed resources
        // in reverse order. Normal shutdown already moved these callbacks out.
        self.operations.close();
        for participant in self.participants.get_mut().drain(..).rev() {
            // Rollback can run while setup is already unwinding. A faulty stop
            // callback must not abort the process or skip the remaining services.
            if std::panic::catch_unwind(std::panic::AssertUnwindSafe(participant.stop)).is_err() {
                eprintln!("rollback callback panicked: {}", participant.name);
            }
        }
    }
}

#[cfg(test)]
#[path = "lifecycle_tests.rs"]
mod tests;
