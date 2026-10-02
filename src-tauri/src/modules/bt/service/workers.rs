//! Completion follows all async workers, blocking children, and unclaimed results.

use crate::core::execution::run_blocking_guarded;
use crate::error::AppResult;
use std::future::Future;
use std::pin::Pin;
use std::task::{Context, Poll};
use tokio::sync::watch;

pub(super) struct Workers {
    stop: watch::Sender<bool>,
    finished: watch::Receiver<()>,
}

#[derive(Clone)]
pub(super) struct Worker {
    stop: watch::Receiver<bool>,
    // Only workers own senders. The receiver closes after the last child exits.
    _finished: watch::Sender<()>,
}

impl Workers {
    pub(super) fn new() -> (Self, Worker) {
        let (stop, cancelled) = watch::channel(false);
        let (finished, receiver) = watch::channel(());
        (
            Self {
                stop,
                finished: receiver,
            },
            Worker {
                stop: cancelled,
                _finished: finished,
            },
        )
    }

    pub(super) fn cancel(&self) {
        self.stop.send_replace(true);
    }

    pub(super) async fn wait(&self) {
        let mut finished = self.finished.clone();
        // No values are sent: channel closure is the completion notification.
        let _ = finished.changed().await;
    }
}

impl Drop for Workers {
    fn drop(&mut self) {
        self.cancel();
    }
}

impl Worker {
    pub(super) fn track<F: Future>(self, future: F) -> Tracked<F> {
        Tracked {
            future: Box::pin(future),
            _worker: self,
        }
    }

    pub(super) async fn cancelled(&self) {
        let mut stop = self.stop.clone();
        let _ = stop.wait_for(|stopped| *stopped).await;
    }

    pub(super) async fn blocking<T, F>(&self, operation: F) -> AppResult<T>
    where
        T: Send + 'static,
        F: FnOnce() -> AppResult<T> + Send + 'static,
    {
        run_blocking_guarded(self.clone(), operation).await
    }
}

pub(super) struct Tracked<F> {
    // Field order guarantees all captured resources drop before completion,
    // including a never-polled or aborted async future.
    future: Pin<Box<F>>,
    _worker: Worker,
}

impl<F: Future> Future for Tracked<F> {
    type Output = F::Output;

    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        self.future.as_mut().poll(cx)
    }
}

#[cfg(test)]
#[path = "workers_tests.rs"]
mod tests;
