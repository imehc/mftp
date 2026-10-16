use std::sync::mpsc;
use std::time::{Duration, Instant};

use super::*;
use crate::modules::todo::note_tests::{Fixture, TEST_LOCK};

#[test]
fn close_waits_for_worker_exit_instead_of_treating_cancel_flag_as_completion() {
    let _serial = TEST_LOCK.lock();
    let fixture = Fixture::new();
    let service = Arc::new(TodoNoteService::new(fixture.repository.clone()));
    let draft = fixture.repository.begin_note_draft(None).unwrap();
    let cancelled = Arc::new(AtomicBool::new(false));
    *service.active.lock() = Some(ActiveImage {
        draft_id: draft.id.clone(),
        cancelled: cancelled.clone(),
    });
    let worker = IMAGE_WORKER.lock();
    let (send, receive) = mpsc::channel();
    let closing = service.clone();
    let thread = std::thread::spawn(move || send.send(closing.close_draft(&draft.id)).unwrap());
    let deadline = Instant::now() + Duration::from_secs(5);
    while !cancelled.load(Ordering::Acquire) && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(1));
    }
    assert!(cancelled.load(Ordering::Acquire));
    assert!(matches!(receive.try_recv(), Err(mpsc::TryRecvError::Empty)));
    drop(worker);
    receive
        .recv_timeout(Duration::from_secs(5))
        .unwrap()
        .unwrap();
    thread.join().unwrap();
    assert_eq!(fixture.scalar("SELECT COUNT(*) FROM todo_note_drafts"), 0);
}

#[test]
fn single_worker_admission_rejects_parallel_import_without_replaying_or_writing() {
    let _serial = TEST_LOCK.lock();
    let fixture = Fixture::new();
    let draft = fixture.repository.begin_note_draft(None).unwrap();
    let worker = IMAGE_WORKER.lock();
    assert_eq!(
        fixture
            .service
            .import_image(&draft.id, "AA==")
            .unwrap_err()
            .code,
        "todo:note_busy"
    );
    assert_eq!(fixture.scalar("SELECT COUNT(*) FROM todo_note_images"), 0);
    drop(worker);
    assert_eq!(
        fixture
            .service
            .import_image(&draft.id, "AA==")
            .unwrap_err()
            .code,
        "todo:note_image_unsupported"
    );
    assert!(fixture.service.active.lock().is_none());
    assert_eq!(fixture.scalar("SELECT COUNT(*) FROM todo_note_images"), 0);
}

#[test]
fn late_image_result_cannot_recreate_closed_draft_or_leak_resources() {
    let _serial = TEST_LOCK.lock();
    let fixture = Fixture::new();
    let draft = fixture.repository.begin_note_draft(None).unwrap();
    let bytes = {
        let image = image::DynamicImage::new_rgb8(8, 8);
        let mut output = std::io::Cursor::new(Vec::new());
        image
            .write_to(&mut output, image::ImageFormat::Png)
            .unwrap();
        output.into_inner()
    };
    let prepared = prepare_image(&bytes).unwrap();
    fixture.repository.close_note_draft(&draft.id).unwrap();
    let error = fixture
        .repository
        .store_draft_image(&draft.id, prepared)
        .unwrap_err();
    assert_eq!(error.code, "todo:note_draft_closed");
    assert_eq!(fixture.scalar("SELECT COUNT(*) FROM todo_note_images"), 0);
}
