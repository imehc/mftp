use super::*;

#[test]
fn rejects_duplicate_tasks_until_the_guard_is_dropped() {
    let manager = Arc::new(AiTaskManager::default());
    let guard = manager.begin("poem:literal".into()).unwrap();
    assert!(manager.begin("poem:literal".into()).is_err());
    drop(guard);
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
