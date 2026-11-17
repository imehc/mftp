use super::*;
use crate::features::todo::{note_summary, note_transfer};
use std::sync::atomic::AtomicBool;

#[test]
fn copying_images_preserves_order_literal_text_and_independent_ownership() {
    let (_root, database, repository) = fixture();
    let mut source = Draft::new();
    source.title = "原任务".into();
    let first = images::import(&database, &source);
    let second = images::import(&database, &source);
    source.document = Some(RichTextDocument::from_markdown(format!(
        "**前文** ![甲](mftp-image:{first})\n\n![乙](mftp-image:{second}) `mftp-image:{first}`"
    )));
    let item = commit(&database, &source).unwrap();
    let mut target = Draft::new();
    target.title = "独立副本".into();
    let pasted = note_transfer::paste(
        &database,
        &target,
        source.document.as_ref().unwrap().source(),
        &AtomicBool::new(false),
    )
    .unwrap();
    let document = RichTextDocument::from_markdown(pasted.source);
    let ids = document.image_ids().unwrap();
    assert_eq!(ids.len(), 2);
    assert!(!ids.contains(&first) && !ids.contains(&second));
    assert!(document.source().contains(&format!("`mftp-image:{first}`")));
    assert_eq!(
        pasted
            .previews
            .iter()
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>(),
        ids
    );
    target.document = Some(document);
    let copied = commit(&database, &target).unwrap();
    let summary = note_summary::load(&database)
        .unwrap()
        .remove(&copied.id)
        .unwrap();
    assert_eq!(
        (summary.first_image, summary.image_count),
        (Some(ids[0].clone()), 2)
    );
    repository.delete_at_revision(&item.id, Some(0)).unwrap();
    let reading = Draft::edit(&repository.get(&copied.id).unwrap());
    assert!(note_transfer::read(&database, &reading, &ids[0]).is_ok());
    assert!(note_transfer::read(&database, &reading, &first).is_err());
    let mut editing = reading;
    editing.document = Some(RichTextDocument::from_markdown("只留文字"));
    commit(&database, &editing).unwrap();
    assert!(note_summary::load(&database).unwrap().is_empty());
    assert_eq!(
        database
            .conn()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM native_note_images", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
}

#[test]
fn missing_cancelled_or_foreign_temporary_images_do_not_partially_copy() {
    let (_root, database, _) = fixture();
    let mut source = Draft::new();
    source.title = "原任务".into();
    let id = images::import(&database, &source);
    source.document = Some(RichTextDocument::from_markdown(format!(
        "![图](mftp-image:{id})"
    )));
    let target = Draft::new();
    assert!(
        note_transfer::paste(
            &database,
            &target,
            source.document.as_ref().unwrap().source(),
            &AtomicBool::new(false)
        )
        .is_err()
    );
    commit(&database, &source).unwrap();
    let missing = uuid::Uuid::new_v4();
    let batch = format!("![一](mftp-image:{id}) ![二](mftp-image:{missing})");
    assert!(note_transfer::paste(&database, &target, &batch, &AtomicBool::new(false)).is_err());
    assert!(
        note_transfer::paste(
            &database,
            &target,
            source.document.as_ref().unwrap().source(),
            &AtomicBool::new(true)
        )
        .is_err()
    );
    assert_eq!(
        database
            .conn()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM native_note_images", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        1
    );
    // Cleanup is scoped to temporary ownership and cannot delete a committed source.
    note_transfer::discard(&database, &target.id, &[id]).unwrap();
    assert_eq!(
        database
            .conn()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM native_note_images", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        1
    );
}

#[test]
fn legacy_summary_migration_is_idempotent_and_preserves_document_and_resources() {
    let (_root, database, _) = fixture();
    let mut draft = Draft::new();
    draft.title = "旧任务".into();
    let id = images::import(&database, &draft);
    draft.document = Some(RichTextDocument::from_markdown(format!(
        "![图](mftp-image:{id})"
    )));
    let item = commit(&database, &draft).unwrap();
    let mut conn = database.conn().unwrap();
    conn.execute_batch("ALTER TABLE native_rich_text_notes RENAME TO legacy_notes;
        CREATE TABLE native_rich_text_notes(item_id TEXT PRIMARY KEY REFERENCES todo_items(id) ON DELETE CASCADE,document TEXT NOT NULL);
        INSERT INTO native_rich_text_notes SELECT item_id,document FROM legacy_notes;
        DROP TABLE legacy_notes;
        UPDATE app_meta SET value='1' WHERE key='native_note_schema_version';").unwrap();
    init(&mut conn).unwrap();
    init(&mut conn).unwrap();
    assert_eq!(
        load(&database, &item.id, None).unwrap(),
        draft.document.unwrap()
    );
    let summary = note_summary::load(&database)
        .unwrap()
        .remove(&item.id)
        .unwrap();
    assert_eq!(
        (summary.first_image, summary.image_count),
        (Some(id.clone()), 1)
    );
    assert!(note_transfer::thumbnail(&database, &item.id, &id).is_ok());
}
