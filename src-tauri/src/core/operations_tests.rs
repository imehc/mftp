use super::*;
use futures_util::poll;

const DEADLINE: Duration = Duration::from_secs(2);

#[tokio::test]
async fn maintenance_reserves_admission_before_draining_all_workers() {
    let operations = Arc::new(Operations::default());
    let first = operations.begin().unwrap();
    let second = operations.begin().unwrap();
    let mut pending = Box::pin(operations.maintenance(DEADLINE));
    assert!(poll!(&mut pending).is_pending());
    assert_eq!(
        operations.begin().err().unwrap().code,
        "app:maintenance_in_progress"
    );
    assert_eq!(
        operations.maintenance(DEADLINE).await.err().unwrap().code,
        "app:maintenance_in_progress"
    );
    drop(first);
    assert!(poll!(&mut pending).is_pending());
    drop(second);
    let maintenance = pending.await.unwrap();
    assert!(!operations.wait_idle(Duration::ZERO));
    drop(maintenance);
    assert!(operations.wait_idle(Duration::ZERO));
    assert!(operations.begin().is_ok());
    assert!(operations.maintenance(DEADLINE).await.is_ok());
}

#[tokio::test]
async fn dropping_pending_maintenance_reopens_admission_without_dropping_workers() {
    let operations = Arc::new(Operations::default());
    let worker = operations.begin().unwrap();
    let mut pending = Box::pin(operations.maintenance(DEADLINE));
    assert!(poll!(&mut pending).is_pending());
    drop(pending);
    assert!(operations.begin().is_ok());
    assert!(!operations.wait_idle(Duration::ZERO));
    drop(worker);
    assert!(operations.wait_idle(Duration::ZERO));
}

#[tokio::test]
async fn maintenance_timeout_does_not_admit_deletion_or_discard_workers() {
    let operations = Arc::new(Operations::default());
    let worker = operations.begin().unwrap();
    let error = operations.maintenance(Duration::ZERO).await.err().unwrap();
    assert_eq!(error, AppError::custom(CustomErrorCode::AppOperationsBusy));
    assert!(operations.begin().is_ok());
    assert!(!operations.wait_idle(Duration::ZERO));
    drop(worker);
    assert!(operations.maintenance(DEADLINE).await.is_ok());
}

#[tokio::test]
async fn shutdown_wakes_pending_maintenance_without_waiting_for_the_worker() {
    let operations = Arc::new(Operations::default());
    let worker = operations.begin().unwrap();
    let mut pending = Box::pin(operations.maintenance(DEADLINE));
    assert!(poll!(&mut pending).is_pending());
    operations.close();
    let error = tokio::time::timeout(DEADLINE, pending)
        .await
        .unwrap()
        .err()
        .unwrap();
    assert_eq!(error.code, "app:shutting_down");
    assert!(!operations.wait_idle(Duration::ZERO));
    drop(worker);
    assert!(operations.wait_idle(Duration::ZERO));
    assert_eq!(operations.begin().err().unwrap().code, "app:shutting_down");
    assert_eq!(
        operations.maintenance(DEADLINE).await.err().unwrap().code,
        "app:shutting_down"
    );
}

#[tokio::test]
async fn maintenance_and_new_worker_cannot_both_win_admission() {
    for _ in 0..32 {
        let operations = Arc::new(Operations::default());
        let start = Arc::new(std::sync::Barrier::new(2));
        let other_operations = operations.clone();
        let other_start = start.clone();
        let worker = std::thread::spawn(move || {
            other_start.wait();
            other_operations.begin()
        });
        start.wait();
        let maintenance = operations.maintenance(Duration::ZERO).await;
        let worker = worker.join().unwrap();
        assert_ne!(maintenance.is_ok(), worker.is_ok());
    }
}
