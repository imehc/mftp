use super::*;
use crate::modules::todo::note_tests::{Fixture, TEST_LOCK};

#[test]
fn idle_and_absolute_expiry_only_clean_mcp_owned_drafts() {
    let _serial = TEST_LOCK.lock();
    let fixture = Fixture::new();
    let local = fixture.repository.begin_note_draft(None).unwrap();
    let drafts = Drafts::new(
        fixture.repository.clone(),
        Arc::new(TodoNoteService::new(fixture.repository.clone())),
    );
    let idle = drafts.begin("idle", None).unwrap().draft.id;
    let aged = drafts.begin("aged", None).unwrap().draft.id;
    fixture.image(&idle, 40);
    fixture.image(&aged, 50);
    {
        let mut entries = drafts.entries.lock();
        entries.get_mut(&idle).unwrap().touched =
            Instant::now() - IDLE_TTL - Duration::from_secs(1);
        entries.get_mut(&aged).unwrap().created = Instant::now() - MAX_AGE - Duration::from_secs(1);
    }
    assert!(!drafts.busy().unwrap());
    assert_eq!(fixture.scalar("SELECT COUNT(*) FROM todo_note_images"), 0);
    assert_eq!(fixture.scalar("SELECT COUNT(*) FROM todo_note_drafts"), 1);
    fixture.repository.ensure_note_draft(&local.id).unwrap();
    assert!(drafts.get("idle", &idle).is_err());
}

#[test]
fn concurrent_draft_calls_reject_without_waiting_or_mutating() {
    let _serial = TEST_LOCK.lock();
    let fixture = Fixture::new();
    let drafts = Drafts::new(
        fixture.repository.clone(),
        Arc::new(TodoNoteService::new(fixture.repository.clone())),
    );
    let draft = drafts.begin("subject", None).unwrap();
    let held = drafts.entries.lock();
    assert_eq!(
        drafts.get("subject", &draft.draft.id).err().unwrap().code,
        "todo:note_busy"
    );
    assert_eq!(fixture.scalar("SELECT COUNT(*) FROM todo_note_drafts"), 1);
    drop(held);
    drafts.close_all().unwrap();
}
