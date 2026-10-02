use super::*;
use std::sync::Arc;
use std::time::Duration;

#[tokio::test]
async fn cancellation_wakes_existing_and_late_waiters_but_keeps_children_alive() {
    let (workers, worker) = Workers::new();
    let child = worker.clone();
    let waiting = tokio::spawn(async move { worker.cancelled().await });
    workers.cancel();
    waiting.await.unwrap();
    child.cancelled().await;
    assert!(
        tokio::time::timeout(Duration::from_millis(20), workers.wait())
            .await
            .is_err()
    );
    drop(child);
    workers.wait().await;
    // A cancelled or completed wait does not consume the completion signal.
    workers.wait().await;
}

#[tokio::test]
async fn aborted_awaiter_keeps_real_worker_and_returned_resource_registered() {
    let (workers, worker) = Workers::new();
    let (started, ready) = tokio::sync::oneshot::channel();
    let (release, released) = std::sync::mpsc::channel();
    let resource = Arc::new(());
    let weak = Arc::downgrade(&resource);
    let task = tokio::spawn(async move {
        worker
            .blocking(move || {
                started.send(()).unwrap();
                released.recv().unwrap();
                Ok(resource)
            })
            .await
    });
    ready.await.unwrap();
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
    workers.cancel();
    assert!(
        tokio::time::timeout(Duration::from_millis(20), workers.wait())
            .await
            .is_err()
    );
    assert!(weak.upgrade().is_some());
    release.send(()).unwrap();
    tokio::time::timeout(Duration::from_secs(2), workers.wait())
        .await
        .unwrap();
    assert!(weak.upgrade().is_none());
}

#[tokio::test]
async fn panic_releases_workers_and_preserves_the_external_join_error() {
    let (workers, worker) = Workers::new();
    let error = worker
        .blocking(|| -> AppResult<()> { panic!("test IO panic") })
        .await
        .unwrap_err();
    assert_eq!(error.kind, crate::error::AppErrorKind::External);
    drop(worker);
    workers.wait().await;

    let (workers, worker) = Workers::new();
    let task = tokio::spawn(async move {
        let _worker = worker;
        panic!("test async worker panic");
    });
    assert!(task.await.unwrap_err().is_panic());
    workers.wait().await;
}

#[tokio::test]
async fn dropping_owner_requests_stop_without_aborting_the_worker() {
    let (workers, worker) = Workers::new();
    drop(workers);
    tokio::time::timeout(Duration::from_secs(1), worker.cancelled())
        .await
        .unwrap();
}

#[tokio::test]
async fn tracked_future_drops_captured_resources_before_reporting_completion() {
    let (workers, worker) = Workers::new();
    let resource = Arc::new(());
    let weak = Arc::downgrade(&resource);
    let future = worker.track(async move {
        let _resource = resource;
        std::future::pending::<()>().await;
    });
    // Dropping before the first poll must follow the same ownership order.
    drop(future);
    workers.wait().await;
    assert!(weak.upgrade().is_none());
}
