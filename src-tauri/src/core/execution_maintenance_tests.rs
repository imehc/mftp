use super::*;
use futures_util::poll;
use parking_lot::Mutex;
use std::sync::mpsc;
use tokio::sync::oneshot;

struct HeldLog {
    started: Mutex<Option<oneshot::Sender<()>>>,
    release: Mutex<mpsc::Receiver<()>>,
}

impl ActivitySink for HeldLog {
    fn record(&self, _: &OperationContext, _: Option<&AppError>) -> AppResult<()> {
        self.started.lock().take().unwrap().send(()).unwrap();
        self.release
            .lock()
            .recv_timeout(Duration::from_secs(5))
            .unwrap();
        Ok(())
    }
}

#[tokio::test]
async fn maintenance_waits_for_real_logs_after_the_command_waiter_is_cancelled() {
    for asynchronous in [false, true] {
        let (started, ready) = oneshot::channel();
        let (release, wait) = mpsc::channel();
        let operations = Arc::new(Operations::default());
        let executor = Executor::new(
            Arc::new(HeldLog {
                started: Mutex::new(Some(started)),
                release: Mutex::new(wait),
            }),
            operations.clone(),
        );
        let caller = executor.clone();
        let task = tokio::spawn(async move {
            let context = OperationContext::new("test", "write", "target");
            if asynchronous {
                caller.asynchronous(context, async { Ok(()) }).await
            } else {
                caller.blocking(context, || Ok(())).await
            }
        });
        ready.await.unwrap();
        task.abort();
        assert!(task.await.is_err());
        let mut pending = Box::pin(executor.maintenance());
        assert!(poll!(&mut pending).is_pending());
        assert_eq!(
            operations.check_admission().unwrap_err().code,
            "app:maintenance_in_progress"
        );
        release.send(()).unwrap();
        let maintenance = tokio::time::timeout(Duration::from_secs(2), pending)
            .await
            .unwrap()
            .unwrap();
        assert!(!operations.wait_idle(Duration::ZERO));
        drop(maintenance);
        assert!(operations.wait_idle(Duration::ZERO));
    }
}

#[tokio::test]
async fn cancelled_maintenance_waiter_keeps_real_deletion_exclusive() {
    for fail in [false, true] {
        let operations = Arc::new(Operations::default());
        let maintenance = operations
            .maintenance(Duration::from_secs(1))
            .await
            .unwrap();
        let (started, ready) = oneshot::channel();
        let (release, wait) = mpsc::channel();
        let deletion = tokio::spawn(run_blocking(move || {
            let _maintenance = maintenance;
            started.send(()).unwrap();
            wait.recv_timeout(Duration::from_secs(5)).unwrap();
            if fail {
                Err(std::io::Error::from(std::io::ErrorKind::PermissionDenied).into())
            } else {
                Ok(())
            }
        }));
        ready.await.unwrap();
        deletion.abort();
        assert!(deletion.await.is_err());
        assert_eq!(
            operations.check_admission().unwrap_err().code,
            "app:maintenance_in_progress"
        );
        assert!(!operations.wait_idle(Duration::ZERO));
        release.send(()).unwrap();
        assert!(operations.wait_idle(Duration::from_secs(2)));
        assert!(operations.begin().is_ok());
    }
}

#[tokio::test]
async fn maintenance_rejects_both_execution_paths_before_work_or_logging() {
    let operations = Arc::new(Operations::default());
    let maintenance = operations
        .maintenance(Duration::from_secs(1))
        .await
        .unwrap();
    let (started, _ready) = oneshot::channel();
    let (_release, wait) = mpsc::channel();
    let executor = Executor::new(
        Arc::new(HeldLog {
            started: Mutex::new(Some(started)),
            release: Mutex::new(wait),
        }),
        operations,
    );
    let context = || OperationContext::new("test", "write", "target");
    assert_eq!(
        executor
            .blocking(context(), || -> AppResult<()> {
                panic!("maintenance allowed a new blocking operation")
            })
            .await
            .unwrap_err()
            .code,
        "app:maintenance_in_progress"
    );
    assert_eq!(
        executor
            .asynchronous(context(), async {
                panic!("maintenance polled a new async operation");
                #[allow(unreachable_code)]
                Ok::<(), AppError>(())
            })
            .await
            .unwrap_err()
            .code,
        "app:maintenance_in_progress"
    );
    drop(maintenance);
}
