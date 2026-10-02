//! Finalize registration follows the last real worker, including blocking children.

use crate::core::execution::run_blocking_guarded;
use crate::error::AppResult;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

#[derive(Default)]
pub(super) struct FinalizeJobs {
    jobs: Mutex<HashMap<String, Arc<JobState>>>,
    closed: AtomicBool,
}

struct JobState {
    cancelled: Arc<AtomicBool>,
    finished: tokio::sync::watch::Sender<bool>,
}

impl FinalizeJobs {
    pub(super) fn begin(self: &Arc<Self>, key: &str) -> Option<FinalizeGuard> {
        let mut jobs = self.jobs.lock();
        if self.closed.load(Ordering::SeqCst) || jobs.contains_key(key) {
            return None;
        }
        let state = Arc::new(JobState {
            cancelled: Arc::new(AtomicBool::new(false)),
            finished: tokio::sync::watch::channel(false).0,
        });
        jobs.insert(key.to_owned(), state.clone());
        Some(FinalizeGuard(Arc::new(Completion {
            jobs: self.clone(),
            key: key.to_owned(),
            state,
        })))
    }

    pub(super) fn cancel(
        &self,
        key: &str,
    ) -> impl std::future::Future<Output = ()> + Send + 'static {
        // Capture the current run before awaiting. A retry under the same hash
        // must not silently redirect an old cancellation waiter to the new job.
        let receiver = self.jobs.lock().get(key).map(|state| {
            state.cancelled.store(true, Ordering::SeqCst);
            state.finished.subscribe()
        });
        async move {
            if let Some(mut receiver) = receiver {
                let _ = receiver.wait_for(|finished| *finished).await;
            }
        }
    }

    pub(super) fn close(&self) -> impl std::future::Future<Output = ()> + Send + 'static {
        {
            let _jobs = self.jobs.lock();
            // Closing and reserving a job share the lock. A command already in
            // flight cannot start an unobserved finalize worker during shutdown.
            self.closed.store(true, Ordering::SeqCst);
        }
        self.cancel_all()
    }

    pub(super) fn cancel_all(&self) -> impl std::future::Future<Output = ()> + Send + 'static {
        let receivers: Vec<_> = {
            let jobs = self.jobs.lock();
            jobs.values()
                .map(|state| {
                    state.cancelled.store(true, Ordering::SeqCst);
                    state.finished.subscribe()
                })
                .collect()
        };
        async move {
            for mut receiver in receivers {
                let _ = receiver.wait_for(|finished| *finished).await;
            }
        }
    }
}

#[derive(Clone)]
pub(super) struct FinalizeGuard(Arc<Completion>);

impl FinalizeGuard {
    pub(super) fn cancelled(&self) -> Arc<AtomicBool> {
        self.0.state.cancelled.clone()
    }

    pub(super) async fn blocking<T, F>(&self, operation: F) -> AppResult<T>
    where
        T: Send + 'static,
        F: FnOnce() -> AppResult<T> + Send + 'static,
    {
        run_blocking_guarded(self.clone(), operation).await
    }
}

struct Completion {
    jobs: Arc<FinalizeJobs>,
    key: String,
    state: Arc<JobState>,
}

impl Drop for Completion {
    fn drop(&mut self) {
        let mut jobs = self.jobs.jobs.lock();
        // A stale completion must never remove a replacement run with the same hash.
        if jobs
            .get(&self.key)
            .is_some_and(|current| Arc::ptr_eq(current, &self.state))
        {
            jobs.remove(&self.key);
        }
        self.state.finished.send_replace(true);
    }
}

#[cfg(test)]
#[path = "jobs_tests.rs"]
mod tests;
