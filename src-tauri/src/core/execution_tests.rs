use super::*;
use crate::error::CustomErrorCode;
use parking_lot::Mutex;
use std::sync::mpsc;
use std::time::Duration;

#[derive(Default)]
struct TestSink {
    fail: bool,
    panic: bool,
    threads: Mutex<Vec<std::thread::ThreadId>>,
}

impl ActivitySink for TestSink {
    fn record(&self, _: &OperationContext, _: Option<&AppError>) -> AppResult<()> {
        self.threads.lock().push(std::thread::current().id());
        if self.panic {
            panic!("broken diagnostic sink");
        }
        if self.fail {
            return Err(std::io::Error::from(std::io::ErrorKind::PermissionDenied).into());
        }
        Ok(())
    }
}

fn context() -> OperationContext {
    OperationContext::new("test", "write", "target")
}

#[test]
fn log_failures_and_panics_do_not_replace_business_results() {
    tauri::async_runtime::block_on(async {
        for (fail, panic) in [(true, false), (false, true)] {
            let sink = Arc::new(TestSink {
                fail,
                panic,
                ..Default::default()
            });
            let executor = Executor::new(sink, Arc::new(Operations::default()));
            assert_eq!(executor.blocking(context(), || Ok(42)).await.unwrap(), 42);
            assert_eq!(
                executor
                    .asynchronous(context(), async { Ok(42) })
                    .await
                    .unwrap(),
                42
            );
            let original =
                AppError::custom(CustomErrorCode::BtFileNotInTask).with_arg("path", "original");
            let error = original.clone();
            assert_eq!(
                executor
                    .blocking(context(), move || Err::<(), _>(error))
                    .await
                    .unwrap_err(),
                original
            );
            let error = original.clone();
            assert_eq!(
                executor
                    .asynchronous(context(), async { Err::<(), _>(error) })
                    .await
                    .unwrap_err(),
                original
            );
        }
    });
}

#[test]
fn blocking_logs_share_worker_and_async_logs_leave_the_callers_thread() {
    tauri::async_runtime::block_on(async {
        let sink = Arc::new(TestSink::default());
        let executor = Executor::new(sink.clone(), Arc::new(Operations::default()));
        let worker = executor
            .blocking(context(), || Ok(std::thread::current().id()))
            .await
            .unwrap();
        assert_eq!(sink.threads.lock()[0], worker);
        let caller = executor
            .asynchronous(context(), async { Ok(std::thread::current().id()) })
            .await
            .unwrap();
        assert_ne!(sink.threads.lock()[1], caller);
    });
}

#[test]
fn dropping_command_awaiter_does_not_release_running_blocking_lease() {
    let operations = Arc::new(Operations::default());
    let sink = Arc::new(TestSink::default());
    let executor = Executor::new(sink.clone(), operations.clone());
    let (started, ready) = mpsc::channel();
    let (release, wait) = mpsc::channel();
    tauri::async_runtime::block_on(async {
        let task = tauri::async_runtime::spawn(async move {
            executor
                .blocking(context(), move || {
                    started.send(()).unwrap();
                    wait.recv().unwrap();
                    Ok(())
                })
                .await
        });
        ready.recv_timeout(Duration::from_secs(2)).unwrap();
        task.abort();
        assert!(task.await.is_err());
        operations.close();
        assert!(!operations.wait_idle(Duration::ZERO));
        release.send(()).unwrap();
        assert!(operations.wait_idle(Duration::from_secs(2)));
        assert_eq!(sink.threads.lock().len(), 1);
    });
}

#[test]
fn shutdown_rejects_new_work_before_executing_or_logging() {
    let operations = Arc::new(Operations::default());
    operations.close();
    let sink = Arc::new(TestSink::default());
    let executor = Executor::new(sink.clone(), operations);
    let error =
        tauri::async_runtime::block_on(executor.blocking(context(), || -> AppResult<()> {
            panic!("closed pipeline executed new work")
        }))
        .unwrap_err();
    assert_eq!(error.code, "app:shutting_down");
    assert!(sink.threads.lock().is_empty());
}

#[test]
fn blocking_preserves_success_and_domain_error() {
    tauri::async_runtime::block_on(async {
        assert_eq!(run_blocking(|| Ok(42)).await.unwrap(), 42);
        let original =
            AppError::custom(CustomErrorCode::BtFileNotInTask).with_arg("path", "folder/file.txt");
        let expected = original.clone();
        let result = run_blocking(move || Err::<(), _>(original)).await;
        assert_eq!(result.unwrap_err(), expected);
    });
}

#[test]
fn blocking_panic_returns_a_safe_external_error() {
    let error = tauri::async_runtime::block_on(run_blocking(|| -> AppResult<()> {
        panic!("sensitive panic payload")
    }))
    .unwrap_err();
    assert_eq!(error.kind, crate::error::AppErrorKind::External);
    assert_eq!(error.code, "task:panicked");
    assert!(!error.message.contains("sensitive"));
}

#[test]
fn cancelled_task_is_distinct_from_a_domain_failure() {
    tauri::async_runtime::block_on(async {
        let task = tauri::async_runtime::spawn(std::future::pending::<()>());
        task.abort();
        let error = AppError::from(task.await.unwrap_err());
        assert_eq!(error.kind, crate::error::AppErrorKind::External);
        assert_eq!(error.code, "task:cancelled");
    });
}

#[test]
fn dropping_async_awaiter_keeps_the_log_worker_lease_until_it_finishes() {
    struct BlockingSink {
        started: mpsc::Sender<()>,
        release: Mutex<mpsc::Receiver<()>>,
    }
    impl ActivitySink for BlockingSink {
        fn record(&self, _: &OperationContext, _: Option<&AppError>) -> AppResult<()> {
            self.started.send(()).unwrap();
            self.release
                .lock()
                .recv_timeout(Duration::from_secs(5))
                .unwrap();
            Ok(())
        }
    }

    let (started, ready) = mpsc::channel();
    let (release, wait) = mpsc::channel();
    let operations = Arc::new(Operations::default());
    let executor = Executor::new(
        Arc::new(BlockingSink {
            started,
            release: Mutex::new(wait),
        }),
        operations.clone(),
    );
    tauri::async_runtime::block_on(async {
        let task = tauri::async_runtime::spawn(async move {
            executor.asynchronous(context(), async { Ok(()) }).await
        });
        ready.recv_timeout(Duration::from_secs(2)).unwrap();
        task.abort();
        assert!(task.await.is_err());
        operations.close();
        assert!(!operations.wait_idle(Duration::ZERO));
        release.send(()).unwrap();
        assert!(operations.wait_idle(Duration::from_secs(2)));
    });
}

#[test]
fn cancelling_an_owned_async_operation_drops_it_before_releasing_admission() {
    struct NotifyDrop(mpsc::Sender<()>);
    impl Drop for NotifyDrop {
        fn drop(&mut self) {
            let _ = self.0.send(());
        }
    }

    let (started, ready) = mpsc::channel();
    let (dropped, completion) = mpsc::channel();
    let operations = Arc::new(Operations::default());
    let sink = Arc::new(TestSink::default());
    let executor = Executor::new(sink.clone(), operations.clone());
    tauri::async_runtime::block_on(async {
        let task = tauri::async_runtime::spawn(async move {
            executor
                .asynchronous(context(), async move {
                    let _resource = NotifyDrop(dropped);
                    started.send(()).unwrap();
                    std::future::pending::<AppResult<()>>().await
                })
                .await
        });
        ready.recv_timeout(Duration::from_secs(2)).unwrap();
        assert!(!operations.wait_idle(Duration::ZERO));
        task.abort();
        assert!(task.await.is_err());
        completion.recv_timeout(Duration::from_secs(2)).unwrap();
        assert!(operations.wait_idle(Duration::ZERO));
        assert!(sink.threads.lock().is_empty());
    });
}

#[test]
fn shutdown_rejects_async_work_without_polling_it() {
    let operations = Arc::new(Operations::default());
    operations.close();
    let sink = Arc::new(TestSink::default());
    let executor = Executor::new(sink.clone(), operations);
    let error = tauri::async_runtime::block_on(executor.asynchronous(context(), async {
        panic!("closed pipeline polled new async work");
        #[allow(unreachable_code)]
        Ok::<(), AppError>(())
    }))
    .unwrap_err();
    assert_eq!(error.code, "app:shutting_down");
    assert!(sink.threads.lock().is_empty());
}
