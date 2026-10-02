use super::*;
use crate::modules::bt::{ports::FileAccess, repository::BtRepository, BtControlAction};
use std::future::Future;
use std::path::{Path, PathBuf};
use std::task::Poll;
use std::time::Duration;

struct Files;
impl FileAccess for Files {
    fn download_dir(&self) -> AppResult<PathBuf> {
        unreachable!("test specifies export paths")
    }
    fn open(&self, _: &Path) -> AppResult<()> {
        Ok(())
    }
}

struct Fixture {
    manager: Arc<BtManager>,
    root: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("bt-admission-{}", uuid::Uuid::new_v4()));
        let repository = BtRepository::new(crate::storage::Storage::new(root.join("db")).unwrap());
        Self {
            manager: Arc::new(BtManager::new(
                repository,
                root.join("bt"),
                Arc::new(|_| {}),
                Arc::new(Files),
            )),
            root,
        }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

async fn assert_pending(future: impl Future) {
    let mut future = Box::pin(future);
    std::future::poll_fn(|cx| {
        assert!(future.as_mut().poll(cx).is_pending());
        Poll::Ready(())
    })
    .await;
}

#[tokio::test]
async fn every_public_operation_waits_for_maintenance_before_side_effects() {
    let fixture = Fixture::new();
    let manager = &fixture.manager;
    let hash = "a".repeat(40);
    let maintenance = manager.maintenance().await.unwrap();
    assert_pending(manager.list()).await;
    assert_pending(manager.probe("not a source")).await;
    assert_pending(manager.dht_status()).await;
    assert_pending(manager.task_peers(&hash)).await;
    assert_pending(manager.control(&hash, BtControlAction::Remove, true)).await;
    assert_pending(manager.add_download("not a source", &hash, vec![])).await;
    assert_pending(manager.export_task(&hash, "not a directory".into())).await;
    assert_pending(manager.browse_files(&hash, None)).await;
    assert_pending(manager.preview_file(&hash, "file".into())).await;
    assert_pending(manager.open_file(&hash, "file".into())).await;
    assert_pending(manager.playability(&hash, 0, true)).await;
    assert!(!fixture.root.join("bt").exists());
    drop(maintenance);
    manager.shutdown().await;
    assert_eq!(
        manager.probe("not a source").await.unwrap_err().code,
        "app:shutting_down"
    );
    assert_eq!(
        manager.task_operation(&hash).await.err().unwrap().code,
        "app:shutting_down"
    );
}

#[tokio::test]
async fn hashes_are_canonical_and_unrelated_tasks_keep_their_concurrency() {
    let fixture = Fixture::new();
    let manager = &fixture.manager;
    let (key, first) = manager.task_operation(&"A".repeat(40)).await.unwrap();
    assert_eq!(key, "a".repeat(40));
    let mut second = Box::pin(manager.task_operation(&key));
    std::future::poll_fn(|cx| {
        assert!(second.as_mut().poll(cx).is_pending());
        Poll::Ready(())
    })
    .await;
    let (_, unrelated) = manager.task_operation(&"b".repeat(40)).await.unwrap();
    assert_pending(manager.task_operation(&key)).await;
    drop(unrelated);
    drop(first);
    let (_, second) = second.await.unwrap();
    assert_pending(manager.task_operation(&key)).await;
    drop(second);
    let (_, _third) = manager.task_operation(&"c".repeat(40)).await.unwrap();
    assert_eq!(manager.admission.tasks.lock().len(), 1);
}

#[tokio::test]
async fn queued_maintenance_prevents_new_readers_from_overtaking_it() {
    let admission = Admission::default();
    let operation = admission.enter().await;
    let mut maintenance = Box::pin(admission.maintenance());
    std::future::poll_fn(|cx| {
        assert!(maintenance.as_mut().poll(cx).is_pending());
        Poll::Ready(())
    })
    .await;
    assert_pending(admission.enter()).await;
    drop(operation);
    let maintenance = maintenance.await;
    assert_pending(admission.enter()).await;
    drop(maintenance);
    tokio::time::timeout(Duration::from_secs(1), admission.enter())
        .await
        .unwrap();
}

#[tokio::test]
async fn dropped_blocking_awaiter_keeps_task_and_maintenance_locks_until_worker_finishes() {
    let admission = Arc::new(Admission::default());
    let operation = admission.enter_task("task").await;
    let (started, ready) = tokio::sync::oneshot::channel();
    let (release, released) = std::sync::mpsc::channel();
    let task = tokio::spawn(async move {
        operation
            .blocking(move || {
                started.send(()).unwrap();
                released.recv().unwrap();
                Ok(())
            })
            .await
    });
    ready.await.unwrap();
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
    assert_pending(admission.enter_task("task")).await;
    assert_pending(admission.maintenance()).await;
    release.send(()).unwrap();
    let maintenance = tokio::time::timeout(Duration::from_secs(2), admission.maintenance())
        .await
        .unwrap();
    // A reset worker must retain this same exclusive guard if its waiter goes away.
    let (started, ready) = tokio::sync::oneshot::channel();
    let (release, released) = std::sync::mpsc::channel();
    let task = tokio::spawn(crate::core::execution::run_blocking(move || {
        let _maintenance = maintenance;
        started.send(()).unwrap();
        released.recv().unwrap();
        Ok(())
    }));
    ready.await.unwrap();
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
    assert_pending(admission.enter()).await;
    release.send(()).unwrap();
    tokio::time::timeout(Duration::from_secs(2), admission.enter())
        .await
        .unwrap();
}

#[tokio::test]
async fn shutdown_waits_for_in_flight_operations_and_rejects_queued_calls() {
    let fixture = Fixture::new();
    let manager = &fixture.manager;
    let operation = manager.operation().await.unwrap();
    let mut shutdown = Box::pin(manager.shutdown());
    std::future::poll_fn(|cx| {
        assert!(shutdown.as_mut().poll(cx).is_pending());
        Poll::Ready(())
    })
    .await;
    assert_eq!(
        manager.operation().await.err().unwrap().code,
        "app:shutting_down"
    );
    drop(operation);
    shutdown.await;
}
