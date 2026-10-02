use std::time::Duration;

use crate::core::operations::Operations;

use super::*;

#[test]
fn rejects_duplicate_tasks_until_the_guard_is_dropped() {
    let manager = Arc::new(AiTaskManager::new(Arc::new(Operations::default())));
    let guard = manager.begin("poem:literal".into()).unwrap();
    assert!(manager.begin("poem:literal".into()).is_err());
    drop(guard);
    assert!(manager.begin("poem:literal".into()).is_ok());
}

#[test]
fn guard_holds_an_operation_lease_until_dropped() {
    let operations = Arc::new(Operations::default());
    let manager = Arc::new(AiTaskManager::new(operations.clone()));
    let guard = manager.begin("poem:literal".into()).unwrap();
    assert!(!operations.wait_idle(Duration::ZERO));
    drop(guard);
    assert!(operations.wait_idle(Duration::ZERO));
}

#[test]
fn duplicate_rejection_does_not_leak_an_operation_lease() {
    let operations = Arc::new(Operations::default());
    let manager = Arc::new(AiTaskManager::new(operations.clone()));
    let guard = manager.begin("poem:literal".into()).unwrap();
    assert_eq!(
        manager.begin("poem:literal".into()).err().unwrap().code,
        "ai:task_already_running"
    );
    assert!(!operations.wait_idle(Duration::ZERO));
    drop(guard);
    assert!(operations.wait_idle(Duration::ZERO));
}

#[tokio::test]
async fn maintenance_rejects_before_registering_a_key() {
    let operations = Arc::new(Operations::default());
    let manager = Arc::new(AiTaskManager::new(operations.clone()));
    let maintenance = operations
        .maintenance(Duration::from_secs(2))
        .await
        .unwrap();
    assert_eq!(
        manager.begin("poem:literal".into()).err().unwrap().code,
        "app:maintenance_in_progress"
    );
    drop(maintenance);
    assert!(manager.begin("poem:literal".into()).is_ok());
}

#[test]
fn stream_event_accepts_only_uuid_request_ids() {
    let id = "67d497e8-4ed9-4e49-b03e-bfd738654501";
    assert_eq!(
        poetry_translation_stream_event(id).unwrap(),
        format!("ai://poetry-translation/{id}")
    );
    assert!(poetry_translation_stream_event("../other-event").is_err());
}
