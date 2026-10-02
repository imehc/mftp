//! Lock order: operation admission, task hash, engine, then publication.
//! Background finalize/preview workers retain their own lifetime tracking.

use super::BtManager;
use crate::core::execution::run_blocking_guarded;
use crate::error::{AppError, AppResult, CustomErrorCode};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::{atomic::Ordering, Arc, Weak};
use tokio::sync::{OwnedMutexGuard, OwnedRwLockReadGuard, OwnedRwLockWriteGuard, RwLock};

#[derive(Default)]
pub(super) struct Admission {
    gate: Arc<RwLock<()>>,
    tasks: Mutex<HashMap<String, Weak<tokio::sync::Mutex<()>>>>,
}

#[derive(Clone)]
pub(super) struct Operation {
    // Clones passed to blocking workers keep both locks until real completion.
    _task: Option<Arc<OwnedMutexGuard<()>>>,
    _admission: Arc<OwnedRwLockReadGuard<()>>,
}

pub(crate) struct Maintenance {
    _guard: OwnedRwLockWriteGuard<()>,
}

impl Admission {
    async fn enter(&self) -> Operation {
        Operation {
            _task: None,
            _admission: Arc::new(self.gate.clone().read_owned().await),
        }
    }

    async fn enter_task(&self, key: &str) -> Operation {
        let mut operation = self.enter().await;
        let gate = {
            let mut tasks = self.tasks.lock();
            // Waiting callers retain the Arc too, so pruning cannot split a
            // live task's lock. Removed tasks do not grow this map forever.
            tasks.retain(|_, gate| gate.strong_count() > 0);
            match tasks.get(key).and_then(Weak::upgrade) {
                Some(gate) => gate,
                None => {
                    let gate = Arc::new(tokio::sync::Mutex::new(()));
                    tasks.insert(key.to_owned(), Arc::downgrade(&gate));
                    gate
                }
            }
        };
        operation._task = Some(Arc::new(gate.lock_owned().await));
        operation
    }

    pub(super) async fn maintenance(&self) -> Maintenance {
        Maintenance {
            _guard: self.gate.clone().write_owned().await,
        }
    }
}

impl Operation {
    pub(super) async fn blocking<T, F>(&self, operation: F) -> AppResult<T>
    where
        T: Send + 'static,
        F: FnOnce() -> AppResult<T> + Send + 'static,
    {
        run_blocking_guarded(self.clone(), operation).await
    }
}

impl BtManager {
    pub(super) async fn operation(&self) -> AppResult<Operation> {
        self.check_admission()?;
        let operation = self.admission.enter().await;
        self.check_admission()?;
        Ok(operation)
    }

    pub(super) async fn task_operation(&self, hash: &str) -> AppResult<(String, Operation)> {
        self.check_admission()?;
        super::parse_info_hash(hash)?;
        // Engine hashes are lowercase. Storage, locking and command lookups
        // must use the same identity even if an IPC caller sends uppercase hex.
        let key = hash.to_ascii_lowercase();
        let operation = self.admission.enter_task(&key).await;
        self.check_admission()?;
        Ok((key, operation))
    }

    pub(crate) async fn maintenance(&self) -> AppResult<Maintenance> {
        self.check_admission()?;
        let maintenance = self.admission.maintenance().await;
        self.check_admission()?;
        Ok(maintenance)
    }

    fn check_admission(&self) -> AppResult<()> {
        if self.stopping.load(Ordering::SeqCst) {
            Err(AppError::custom(CustomErrorCode::AppShuttingDown))
        } else {
            Ok(())
        }
    }
}

#[cfg(test)]
#[path = "admission_tests.rs"]
mod tests;
