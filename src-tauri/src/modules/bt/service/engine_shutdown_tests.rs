use super::*;
use crate::modules::bt::ports::FileAccess;
use crate::modules::bt::repository::BtRepository;
use std::future::Future;
use std::path::PathBuf;
use std::task::Poll;

struct Files;
impl FileAccess for Files {
    fn download_dir(&self) -> AppResult<PathBuf> {
        unreachable!("shutdown does not resolve export paths")
    }
    fn open(&self, _: &Path) -> AppResult<()> {
        unreachable!("shutdown does not open files")
    }
}

struct Fixture {
    manager: BtManager,
    root: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("bt-engine-stop-{}", uuid::Uuid::new_v4()));
        let repository = BtRepository::new(crate::storage::Storage::new(root.join("db")).unwrap());
        Self {
            manager: BtManager::new(
                repository,
                root.join("bt"),
                Arc::new(|_| {}),
                Arc::new(Files),
            ),
            root,
        }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

#[tokio::test]
async fn exit_waits_for_initialization_lock_and_rejects_queued_startup() {
    let fixture = Fixture::new();
    let manager = &fixture.manager;
    let initializing = manager.engine.lock().await;
    let mut stopping = Box::pin(manager.shutdown());
    std::future::poll_fn(|cx| {
        assert!(stopping.as_mut().poll(cx).is_pending());
        Poll::Ready(())
    })
    .await;
    assert!(manager.stopping.load(Ordering::SeqCst));
    let mut starting = Box::pin(manager.ensure_engine());
    std::future::poll_fn(|cx| {
        assert!(starting.as_mut().poll(cx).is_pending());
        Poll::Ready(())
    })
    .await;
    drop(initializing);
    stopping.await;
    assert_eq!(starting.await.err().unwrap().code, "app:shutting_down");
    assert!(!fixture.root.join("bt").exists());
    manager.shutdown().await;
}

#[tokio::test]
async fn dropped_shutdown_waiter_retains_finalizing_workers_and_closes_new_jobs() {
    let fixture = Fixture::new();
    let manager = &fixture.manager;
    let guard = manager.finalize_jobs.begin("packing").unwrap();
    let cancelled = guard.cancelled();
    let (started, ready) = tokio::sync::oneshot::channel();
    let (release, released) = std::sync::mpsc::channel();
    let task = tokio::spawn(async move {
        guard
            .blocking(move || {
                started.send(()).unwrap();
                released.recv().unwrap();
                Ok(())
            })
            .await
    });
    ready.await.unwrap();
    let mut stopping = Box::pin(manager.shutdown());
    std::future::poll_fn(|cx| {
        assert!(stopping.as_mut().poll(cx).is_pending());
        Poll::Ready(())
    })
    .await;
    drop(stopping);
    assert!(cancelled.load(Ordering::SeqCst));
    assert!(manager.finalize_jobs.begin("new task").is_none());
    assert!(
        tokio::time::timeout(Duration::from_millis(20), manager.shutdown())
            .await
            .is_err()
    );
    release.send(()).unwrap();
    tokio::time::timeout(Duration::from_secs(2), manager.shutdown())
        .await
        .unwrap();
    task.await.unwrap().unwrap();
}

#[tokio::test]
async fn temporary_background_stop_keeps_later_finalize_admission_open() {
    let fixture = Fixture::new();
    let manager = &fixture.manager;
    let guard = manager.finalize_jobs.begin("packing").unwrap();
    let cancelled = guard.cancelled();
    let mut stopping = Box::pin(manager.stop_background_work());
    std::future::poll_fn(|cx| {
        assert!(stopping.as_mut().poll(cx).is_pending());
        Poll::Ready(())
    })
    .await;
    assert!(cancelled.load(Ordering::SeqCst));
    drop(guard);
    stopping.await;
    assert!(!manager.stopping.load(Ordering::SeqCst));
    assert!(manager.finalize_jobs.begin("packing").is_some());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cancelled_temporary_stop_is_drained_before_a_later_engine_request() {
    let fixture = Fixture::new();
    let manager = &fixture.manager;
    let session = Session::new_with_opts(
        fixture.root.clone(),
        SessionOptions {
            dht: None,
            disable_trackers: true,
            persistence: None,
            listen: None,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let (pump, worker) = super::super::workers::Workers::new();
    *manager.engine.lock().await = Some(Engine {
        session,
        pump,
        stream_server: None,
        stopping: false,
    });
    let mut stopping = Box::pin(manager.stop_background_work());
    std::future::poll_fn(|cx| {
        assert!(stopping.as_mut().poll(cx).is_pending());
        Poll::Ready(())
    })
    .await;
    drop(stopping);
    assert!(manager.engine_running().is_none());
    let mut starting = Box::pin(manager.ensure_engine());
    std::future::poll_fn(|cx| {
        assert!(starting.as_mut().poll(cx).is_pending());
        Poll::Ready(())
    })
    .await;
    drop(starting);
    drop(worker);
    tokio::time::timeout(Duration::from_secs(3), manager.stop_background_work())
        .await
        .unwrap();
    assert!(manager.engine.lock().await.is_none());
    assert!(!manager.stopping.load(Ordering::SeqCst));
}
