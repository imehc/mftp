use super::*;

impl FinalizeJobs {
    fn contains(&self, key: &str) -> bool {
        self.jobs.lock().contains_key(key)
    }
}

#[test]
fn cancellation_does_not_release_registration_and_retries_get_a_new_token() {
    let jobs = Arc::new(FinalizeJobs::default());
    let first = jobs.begin("task").unwrap();
    let first_token = first.cancelled();
    assert!(jobs.begin("task").is_none());
    drop(jobs.cancel("task"));
    assert!(first_token.load(Ordering::SeqCst));
    assert!(jobs.contains("task"));
    let child = first.clone();
    drop(first);
    assert!(jobs.begin("task").is_none());
    drop(child);
    let retry = jobs.begin("task").unwrap();
    assert!(!Arc::ptr_eq(&first_token, &retry.cancelled()));
    assert!(!retry.cancelled().load(Ordering::SeqCst));
    drop(jobs.close());
    assert!(retry.cancelled().load(Ordering::SeqCst));
    drop(retry);
    assert!(!jobs.contains("task"));
    assert!(jobs.begin("after shutdown").is_none());
}

#[tokio::test]
async fn dropped_awaiter_keeps_registration_until_the_real_blocking_worker_finishes() {
    let jobs = Arc::new(FinalizeJobs::default());
    let guard = jobs.begin("task").unwrap();
    let (started, ready) = tokio::sync::oneshot::channel();
    let (release, released) = std::sync::mpsc::channel();
    let task = tokio::spawn(async move {
        guard
            .blocking(move || {
                let _ = started.send(());
                released.recv().unwrap();
                Ok(())
            })
            .await
    });
    ready.await.unwrap();
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
    assert!(jobs.contains("task"));
    assert!(jobs.begin("task").is_none());
    release.send(()).unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(2), jobs.cancel("task"))
        .await
        .unwrap();
    assert!(jobs.begin("task").is_some());
}

#[tokio::test]
async fn panicked_async_and_blocking_jobs_release_their_registrations() {
    let jobs = Arc::new(FinalizeJobs::default());
    let guard = jobs.begin("async").unwrap();
    let task = tokio::spawn(async move {
        let _guard = guard;
        panic!("test finalize panic");
    });
    assert!(task.await.unwrap_err().is_panic());
    assert!(!jobs.contains("async"));

    let guard = jobs.begin("blocking").unwrap();
    let error = guard
        .blocking(|| -> AppResult<()> {
            panic!("test archive panic");
        })
        .await
        .unwrap_err();
    assert_eq!(error.kind, crate::error::AppErrorKind::External);
    // The asynchronous parent still owns the job until it has handled the failure.
    assert!(jobs.contains("blocking"));
    drop(guard);
    assert!(!jobs.contains("blocking"));
}

#[test]
fn stale_cleanup_does_not_remove_a_new_run() {
    let jobs = Arc::new(FinalizeJobs::default());
    let stale = jobs.begin("task").unwrap();
    let replacement = Arc::new(JobState {
        cancelled: Arc::new(AtomicBool::new(false)),
        finished: tokio::sync::watch::channel(false).0,
    });
    jobs.jobs.lock().insert("task".into(), replacement.clone());
    drop(stale);
    assert!(Arc::ptr_eq(
        jobs.jobs.lock().get("task").unwrap(),
        &replacement
    ));
}

#[tokio::test]
async fn completion_waiter_stays_bound_to_the_original_run() {
    let jobs = Arc::new(FinalizeJobs::default());
    let first = jobs.begin("task").unwrap();
    let completed = jobs.cancel("task");
    drop(first);
    let retry = jobs.begin("task").unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(1), completed)
        .await
        .unwrap();
    assert!(jobs.contains("task"));
    assert!(!retry.cancelled().load(Ordering::SeqCst));
}
