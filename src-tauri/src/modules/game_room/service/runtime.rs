use crate::core::operations::OperationLease;
use parking_lot::{Condvar, Mutex};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use super::wire::PeerLink;

/// A per-generation signal wakes sleeping workers without losing a stop request.
#[derive(Default)]
pub(super) struct StopSignal {
    stopped: Mutex<bool>,
    changed: Condvar,
}

impl StopSignal {
    pub(super) fn stop(&self) {
        *self.stopped.lock() = true;
        self.changed.notify_all();
    }

    pub(super) fn is_stopped(&self) -> bool {
        *self.stopped.lock()
    }

    pub(super) fn wait(&self, duration: Duration) -> bool {
        let deadline = Instant::now() + duration;
        let mut stopped = self.stopped.lock();
        while !*stopped {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                break;
            }
            self.changed.wait_for(&mut stopped, remaining);
        }
        *stopped
    }
}

/// The owner stays in the manager while stopping. Drop also rolls back partially
/// started generations, and releases admission only after all workers are joined.
pub(super) struct RoomHandle {
    pub(super) stop: Arc<StopSignal>,
    pub(super) peer: Option<Arc<PeerLink>>,
    workers: Vec<JoinHandle<()>>,
    _lease: OperationLease,
}

impl RoomHandle {
    pub(super) fn new(lease: OperationLease) -> Self {
        Self {
            stop: Arc::new(StopSignal::default()),
            peer: None,
            workers: Vec::new(),
            _lease: lease,
        }
    }

    pub(super) fn spawn(
        &mut self,
        name: &str,
        worker: impl FnOnce() + Send + 'static,
    ) -> std::io::Result<()> {
        self.workers
            .push(thread::Builder::new().name(name.into()).spawn(worker)?);
        Ok(())
    }
    pub(super) fn stop_and_join(&mut self) {
        self.stop.stop();
        if let Some(peer) = self.peer.take() {
            peer.leave();
        }
        // The accept worker owns and joins every handshake/reader connection.
        for worker in self.workers.drain(..).rev() {
            let _ = worker.join();
        }
    }
}

impl Drop for RoomHandle {
    fn drop(&mut self) {
        self.stop_and_join();
    }
}
