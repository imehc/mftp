use super::*;
use crate::error::CustomErrorCode;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc;
use tokio::sync::oneshot;

#[derive(Default)]
struct RecordingSink(AtomicUsize);

impl ActivitySink for RecordingSink {
    fn record(&self, _: &OperationContext, _: Option<&AppError>) -> AppResult<()> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}

#[tokio::test]
async fn unlogged_work_runs_off_the_caller_and_preserves_results_without_logs() {
    let operations = Arc::new(Operations::default());
    let sink = Arc::new(RecordingSink::default());
    let executor = Executor::new(sink.clone(), operations.clone());
    let caller = std::thread::current().id();
    let worker = executor
        .blocking_unlogged(|| Ok(std::thread::current().id()))
        .await
        .unwrap();
    assert_ne!(caller, worker);
    let error = AppError::custom(CustomErrorCode::AppOperationsBusy).with_arg("operation", "read");
    let returned = error.clone();
    let result: AppResult<()> = executor.blocking_unlogged(move || Err(returned)).await;
    assert_eq!(result.unwrap_err(), error);
    assert_eq!(sink.0.load(Ordering::SeqCst), 0);
    assert!(operations.wait_idle(Duration::ZERO));
}

#[tokio::test]
async fn unlogged_work_rejects_maintenance_and_shutdown_before_entering_worker() {
    let operations = Arc::new(Operations::default());
    let sink = Arc::new(RecordingSink::default());
    let executor = Executor::new(sink.clone(), operations.clone());
    let maintenance = executor.maintenance().await.unwrap();
    let calls = Arc::new(AtomicUsize::new(0));
    for expected in ["app:maintenance_in_progress", "app:shutting_down"] {
        if expected == "app:shutting_down" {
            operations.close();
        }
        let observed = calls.clone();
        assert_eq!(
            executor
                .blocking_unlogged(move || {
                    observed.fetch_add(1, Ordering::SeqCst);
                    Ok(())
                })
                .await
                .unwrap_err()
                .code,
            expected
        );
    }
    drop(maintenance);
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    assert_eq!(sink.0.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn cancelled_unlogged_waiter_retains_admission_until_real_worker_finishes() {
    let operations = Arc::new(Operations::default());
    let sink = Arc::new(RecordingSink::default());
    let executor = Executor::new(sink.clone(), operations.clone());
    let (started, ready) = oneshot::channel();
    let (release, finish) = mpsc::channel();
    let completed = Arc::new(AtomicUsize::new(0));
    let completed_worker = completed.clone();
    let caller = executor.clone();
    let task = tokio::spawn(async move {
        caller
            .blocking_unlogged(move || {
                started.send(()).unwrap();
                finish.recv_timeout(Duration::from_secs(3)).unwrap();
                completed_worker.fetch_add(1, Ordering::SeqCst);
                Ok(())
            })
            .await
    });
    ready.await.unwrap();
    task.abort();
    assert!(task.await.is_err());
    let mut maintenance = Box::pin(executor.maintenance());
    assert!(futures_util::poll!(&mut maintenance).is_pending());
    assert_eq!(completed.load(Ordering::SeqCst), 0);
    release.send(()).unwrap();
    let guard = tokio::time::timeout(Duration::from_secs(2), maintenance)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(completed.load(Ordering::SeqCst), 1);
    assert_eq!(sink.0.load(Ordering::SeqCst), 0);
    drop(guard);
    assert!(operations.wait_idle(Duration::ZERO));
}
