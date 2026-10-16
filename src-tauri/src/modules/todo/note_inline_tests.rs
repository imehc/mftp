use serde_json::json;

use super::model::TodoItemInput;
use super::note_model::{TodoNoteBlock, TodoNoteDocument, TodoNoteInline, TodoNoteSaveInput};
use super::note_tests::{Fixture, TEST_LOCK};
use crate::models::{ExportSection, ImportMode};

fn paragraph(content: Vec<TodoNoteInline>) -> TodoNoteDocument {
    TodoNoteDocument {
        version: 2,
        blocks: vec![TodoNoteBlock::Paragraph { content }],
    }
}

#[test]
fn inline_images_preserve_order_projection_and_backup_ownership() {
    let _serial = TEST_LOCK.lock();
    let fixture = Fixture::new();
    let draft = fixture.repository.begin_note_draft(None).unwrap();
    let first = fixture.image(&draft.id, 10);
    let second = fixture.image(&draft.id, 20);
    let document = paragraph(vec![
        TodoNoteInline::Text {
            text: "前文".into(),
        },
        TodoNoteInline::Image {
            asset_id: first.clone(),
        },
        TodoNoteInline::Text {
            text: "中间".into(),
        },
        TodoNoteInline::Image {
            asset_id: second.clone(),
        },
        TodoNoteInline::HardBreak,
        TodoNoteInline::Text {
            text: "后文".into(),
        },
    ]);
    let saved = fixture
        .service
        .save(TodoNoteSaveInput {
            draft_id: draft.id,
            metadata: TodoItemInput {
                title: "Inline".into(),
                category: None,
                notes: None,
                due_date: None,
                due_at: None,
                completed: false,
                priority: None,
            },
            document: document.clone(),
        })
        .unwrap();
    assert_eq!(saved.document, document);
    assert_eq!(saved.item.notes.as_deref(), Some("前文中间\n后文"));
    assert_eq!(
        saved.document.image_ids(),
        vec![first.as_str(), second.as_str()]
    );
    let summary = fixture.repository.note_summaries().unwrap().remove(0);
    assert_eq!(summary.image_count, 2);
    assert_eq!(summary.first_image.unwrap().id, first);
    let raw = fixture
        .storage
        .export_document(&[ExportSection::Todo], None)
        .unwrap();
    let target = Fixture::new();
    target
        .storage
        .import_document(&raw, None, ImportMode::Append)
        .unwrap();
    let item = &target.repository.list().unwrap()[0];
    let restored = target.repository.note_details(&item.id).unwrap();
    assert_eq!(restored.document.plain_text(), document.plain_text());
    assert_ne!(restored.document.image_ids(), document.image_ids());
    for id in restored.document.image_ids() {
        target
            .repository
            .note_image_data(id, Some(&item.id), None, false)
            .unwrap();
    }
    let edit = fixture
        .repository
        .begin_note_draft(Some(&saved.item.id))
        .unwrap();
    fixture
        .service
        .save(TodoNoteSaveInput {
            draft_id: edit.id,
            metadata: TodoItemInput {
                title: "Inline".into(),
                category: None,
                notes: None,
                due_date: None,
                due_at: None,
                completed: false,
                priority: None,
            },
            document: paragraph(vec![TodoNoteInline::Text {
                text: "删除图片后".into(),
            }]),
        })
        .unwrap();
    assert_eq!(fixture.scalar("SELECT COUNT(*) FROM todo_note_images"), 0);
}

#[test]
fn inline_schema_rejects_version_mismatch_invalid_ids_and_excess_nodes() {
    for raw in [
        json!({"version":1,"blocks":[{"type":"paragraph","content":[]}]}),
        json!({"version":2,"blocks":[{"type":"image","assetId":uuid::Uuid::new_v4().to_string()}]}),
        json!({"version":2,"blocks":[{"type":"paragraph","content":[{"type":"image","assetId":"invalid"}]}]}),
    ] {
        if let Ok(doc) = serde_json::from_value::<TodoNoteDocument>(raw) {
            assert!(doc.validate().is_err());
        }
    }
    let excessive = paragraph(vec![TodoNoteInline::HardBreak; 2_000]);
    assert!(excessive.validate().is_err());
    let too_many_images = paragraph(vec![
        TodoNoteInline::Image {
            asset_id: uuid::Uuid::new_v4().to_string(),
        };
        11
    ]);
    assert!(too_many_images.validate().is_err());
    let remote = json!({"version":2,"blocks":[{"type":"paragraph","content":[{"type":"image","assetId":uuid::Uuid::new_v4().to_string(),"src":"https://example.invalid"}]}]});
    assert!(serde_json::from_value::<TodoNoteDocument>(remote).is_err());
}

#[test]
fn plain_text_migration_preserves_blank_lines_and_literal_markup() {
    let text = "第一行\n\n<script>字面文本</script>\n";
    let document = TodoNoteDocument::from_plain_text(Some(text));
    document.validate().unwrap();
    assert_eq!(document.version, 2);
    assert_eq!(document.plain_text().as_deref(), Some(text));
    assert!(document.image_ids().is_empty());
}
