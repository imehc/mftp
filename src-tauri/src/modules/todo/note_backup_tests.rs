use serde_json::{json, Value};

use super::note_model::TodoNoteDocument;
use super::note_tests::{Fixture, TEST_LOCK};
use crate::models::{ExportSection, ImportMode};

#[test]
fn plain_and_encrypted_backups_preserve_images_code_and_remap_ownership_in_all_modes() {
    let _serial = TEST_LOCK.lock();
    let source = Fixture::new();
    let saved = source.saved();
    let cancelled = source.repository.begin_note_draft(None).unwrap();
    source.image(&cancelled.id, 220);
    for password in [None, Some("isolated-test-password")] {
        let raw = source
            .storage
            .export_document(&[ExportSection::Todo], password)
            .unwrap();
        let envelope: Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(envelope["format"], 2);
        let target = Fixture::new();
        for mode in [ImportMode::Overwrite, ImportMode::Merge, ImportMode::Append] {
            let report = target
                .storage
                .import_document(&raw, password, mode)
                .unwrap();
            assert_eq!(report.sections[0].inserted + report.sections[0].updated, 1);
            let items = target.repository.list().unwrap();
            assert_eq!(items.len(), if mode == ImportMode::Append { 2 } else { 1 });
            for item in items {
                let restored = target.repository.note_details(&item.id).unwrap();
                assert_eq!(restored.item.notes, saved.item.notes);
                assert_eq!(restored.document.plain_text(), saved.document.plain_text());
                assert_eq!(restored.document.image_ids().len(), 1);
                assert_ne!(restored.document.image_ids(), saved.document.image_ids());
                let image = target
                    .repository
                    .note_image_data(
                        restored.document.image_ids()[0],
                        Some(&item.id),
                        None,
                        false,
                    )
                    .unwrap();
                let original = source
                    .repository
                    .note_image_data(
                        saved.document.image_ids()[0],
                        Some(&saved.item.id),
                        None,
                        false,
                    )
                    .unwrap();
                assert_eq!(image.data_base64, original.data_base64);
            }
        }
        assert_eq!(target.scalar("SELECT COUNT(*) FROM todo_note_drafts"), 0);
    }
}

#[test]
fn invalid_backup_rolls_back_overwrite_and_does_not_silently_drop_images() {
    let _serial = TEST_LOCK.lock();
    let fixture = Fixture::new();
    let saved = fixture.saved();
    let raw = fixture
        .storage
        .export_document(&[ExportSection::Todo], None)
        .unwrap();
    let value: Value = serde_json::from_str(&raw).unwrap();
    let mut invalid = Vec::new();
    let mut missing = value.clone();
    missing["sections"]["todo"]["items"][0]["images"] = json!([]);
    invalid.push(missing);
    let mut corrupt = value.clone();
    corrupt["sections"]["todo"]["items"][0]["images"][0]["dataBase64"] = json!("AA==");
    invalid.push(corrupt);
    let mut version = value.clone();
    version["sections"]["todo"]["items"][0]["document"]["version"] = json!(99);
    invalid.push(version);
    let mut downgraded = value.clone();
    downgraded["format"] = json!(1);
    invalid.push(downgraded);
    let mut duplicate = value.clone();
    duplicate["sections"]["todo"]["items"]
        .as_array_mut()
        .unwrap()
        .push(value["sections"]["todo"]["items"][0].clone());
    invalid.push(duplicate);
    let mut oversize = value.clone();
    oversize["sections"]["todo"]["items"][0]["images"][0]["dataBase64"] = json!(
        base64::Engine::encode(&base64::engine::general_purpose::STANDARD, vec![0; 500_001])
    );
    invalid.push(oversize);
    for value in invalid {
        assert!(fixture
            .storage
            .import_document(&value.to_string(), None, ImportMode::Overwrite)
            .is_err());
        assert_eq!(
            fixture
                .repository
                .note_details(&saved.item.id)
                .unwrap()
                .document,
            saved.document
        );
        assert_eq!(fixture.scalar("SELECT COUNT(*) FROM todo_note_images"), 1);
    }
}

#[test]
fn old_plain_text_backup_can_replace_rich_notes_without_leaving_assets() {
    let _serial = TEST_LOCK.lock();
    let fixture = Fixture::new();
    let saved = fixture.saved();
    let raw = json!({"app":"mftp", "format":1, "sections":{"todo":[saved.item]}});
    fixture
        .storage
        .import_document(&raw.to_string(), None, ImportMode::Merge)
        .unwrap();
    let restored = fixture.repository.note_details(&saved.item.id).unwrap();
    assert_eq!(
        restored.document,
        TodoNoteDocument::from_plain_text(saved.item.notes.as_deref())
    );
    assert_eq!(fixture.scalar("SELECT COUNT(*) FROM todo_note_images"), 0);
    assert_eq!(fixture.scalar("SELECT COUNT(*) FROM todo_notes"), 0);
    let raw = fixture
        .storage
        .export_document(&[ExportSection::Todo], None)
        .unwrap();
    let value: Value = serde_json::from_str(&raw).unwrap();
    assert!(value["sections"]["todo"].is_array());
    assert_eq!(value["format"], 1);
}

#[test]
fn future_backup_versions_fail_before_any_existing_data_is_replaced() {
    let _serial = TEST_LOCK.lock();
    let fixture = Fixture::new();
    let saved = fixture.saved();
    let value = json!({"app":"mftp","format":99,"sections":{"todo":[]}});
    assert!(fixture
        .storage
        .inspect_document(&value.to_string())
        .is_err());
    assert!(fixture
        .storage
        .import_document(&value.to_string(), None, ImportMode::Overwrite)
        .is_err());
    assert_eq!(
        fixture
            .repository
            .note_details(&saved.item.id)
            .unwrap()
            .document,
        saved.document
    );
}
