use super::*;

#[test]
fn image_draft_and_document_limits_are_enforced_without_partial_writes() {
    let _serial = TEST_LOCK.lock();
    let fixture = Fixture::new();
    let first = fixture.repository.begin_note_draft(None).unwrap();
    for _ in 0..10 {
        fixture.image(&first.id, 1);
    }
    let error = fixture
        .repository
        .copy_note_image(&first.id, "unrelated", "unrelated")
        .unwrap_err();
    assert_eq!(error.code, "todo:note_image_limit");
    for _ in 1..8 {
        fixture.repository.begin_note_draft(None).unwrap();
    }
    assert_eq!(
        fixture.repository.begin_note_draft(None).unwrap_err().code,
        "todo:note_draft_limit"
    );
    let image = fixture
        .storage
        .conn()
        .unwrap()
        .query_row("SELECT id FROM todo_note_images LIMIT 1", [], |row| {
            row.get::<_, String>(0)
        })
        .unwrap();
    let error = fixture
        .service
        .save(TodoNoteSaveInput {
            draft_id: first.id,
            metadata: metadata(),
            document: document(vec![
                TodoNoteBlock::Paragraph {
                    content: vec![TodoNoteInline::Image { asset_id: image }]
                };
                11
            ]),
        })
        .unwrap_err();
    assert_eq!(error.code, "todo:note_invalid");
    assert_eq!(fixture.scalar("SELECT COUNT(*) FROM todo_items"), 0);
}

#[test]
fn cleanup_reset_and_stale_runtime_collection_remove_only_owned_data() {
    let _serial = TEST_LOCK.lock();
    let fixture = Fixture::new();
    let saved = fixture.saved();
    let stale = fixture.repository.begin_note_draft(None).unwrap();
    fixture.image(&stale.id, 1);
    fixture
        .storage
        .conn()
        .unwrap()
        .execute(
            "UPDATE todo_note_drafts SET runtime_id='retired' WHERE id=?1",
            [&stale.id],
        )
        .unwrap();
    fixture.repository.begin_note_draft(None).unwrap();
    assert_eq!(fixture.scalar("SELECT COUNT(*) FROM todo_note_images"), 1);
    assert_eq!(
        fixture
            .repository
            .note_details(&saved.item.id)
            .unwrap()
            .document,
        saved.document
    );
    let draft = fixture.repository.begin_note_draft(None).unwrap();
    fixture.image(&draft.id, 1);
    let usage = fixture.storage.app_data_usage().unwrap().todo_bytes;
    assert!(usage > 100);
    assert_eq!(
        fixture
            .storage
            .clear_data_module(AppDataModule::Todo)
            .unwrap(),
        1
    );
    for table in [
        "todo_note_images",
        "todo_note_drafts",
        "todo_notes",
        "todo_items",
    ] {
        assert_eq!(fixture.scalar(&format!("SELECT COUNT(*) FROM {table}")), 0);
    }
    assert_eq!(fixture.storage.app_data_usage().unwrap().todo_bytes, 0);
    fixture.saved();
    let draft = fixture.repository.begin_note_draft(None).unwrap();
    fixture.image(&draft.id, 1);
    fixture.storage.reset_database().unwrap();
    assert_eq!(fixture.scalar("SELECT COUNT(*) FROM todo_note_images"), 0);
    assert_eq!(fixture.scalar("SELECT COUNT(*) FROM todo_note_drafts"), 0);
    let reopened = Storage::new(fixture.root.clone()).unwrap();
    assert!(TodoRepository::new(reopened).list().unwrap().is_empty());
}

#[test]
fn database_constraints_block_oversize_images_and_cross_ownership() {
    let _serial = TEST_LOCK.lock();
    let fixture = Fixture::new();
    let saved = fixture.saved();
    let conn = fixture.storage.conn().unwrap();
    assert!(conn
        .execute("UPDATE todo_note_images SET data=zeroblob(500001)", [])
        .is_err());
    assert!(conn
        .execute("UPDATE todo_note_images SET thumbnail=zeroblob(50001)", [])
        .is_err());
    assert!(conn
        .execute("UPDATE todo_note_images SET draft_id='missing'", [])
        .is_err());
    assert!(fixture
        .repository
        .note_image_data(saved.document.image_ids()[0], None, None, false)
        .is_err());
}
