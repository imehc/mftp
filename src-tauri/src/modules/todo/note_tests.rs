use std::io::Cursor;
use std::path::PathBuf;

use base64::{engine::general_purpose::STANDARD, Engine};
use parking_lot::Mutex;
use serde_json::json;

use super::model::{TodoItemInput, TodoPriority};
use super::note_model::{
    TodoNoteBlock, TodoNoteDocument, TodoNoteInline, TodoNoteSaveInput, MAX_NOTE_BYTES,
};
use super::note_service::TodoNoteService;
use super::TodoRepository;
use crate::models::AppDataModule;
use crate::storage::Storage;

pub(crate) static TEST_LOCK: Mutex<()> = Mutex::new(());

pub(super) struct Fixture {
    pub(super) root: PathBuf,
    pub(super) storage: Storage,
    pub(super) repository: TodoRepository,
    pub(super) service: TodoNoteService,
}

impl Fixture {
    pub(super) fn new() -> Self {
        let root = std::env::temp_dir().join(format!("mftp-todo-notes-{}", uuid::Uuid::new_v4()));
        let storage = Storage::new(root.clone()).unwrap();
        let repository = TodoRepository::new(storage.clone());
        let service = TodoNoteService::new(repository.clone());
        Self {
            root,
            storage,
            repository,
            service,
        }
    }

    pub(super) fn scalar(&self, query: &str) -> i64 {
        self.storage
            .conn()
            .unwrap()
            .query_row(query, [], |row| row.get(0))
            .unwrap()
    }

    pub(super) fn image(&self, draft: &str, color: u8) -> String {
        let image = image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            12,
            8,
            image::Rgba([color, 0, 0, 128]),
        ));
        let mut bytes = Cursor::new(Vec::new());
        image.write_to(&mut bytes, image::ImageFormat::Png).unwrap();
        self.service
            .import_image(draft, &STANDARD.encode(bytes.into_inner()))
            .unwrap()
            .image
            .id
    }

    pub(super) fn saved(&self) -> super::note_model::TodoNoteDetails {
        let draft = self.repository.begin_note_draft(None).unwrap();
        let image = self.image(&draft.id, 20);
        self.service
            .save(TodoNoteSaveInput {
                draft_id: draft.id,
                metadata: metadata(),
                document: document(vec![
                    TodoNoteBlock::Paragraph {
                        content: vec![TodoNoteInline::Text {
                            text: "说明\n第二行".into(),
                        }],
                    },
                    TodoNoteBlock::Paragraph {
                        content: vec![TodoNoteInline::Image { asset_id: image }],
                    },
                    TodoNoteBlock::CodeBlock {
                        text: "  <div>代码</div>\n\treturn 1;\n".into(),
                    },
                ]),
            })
            .unwrap()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.root).unwrap();
    }
}

fn metadata() -> TodoItemInput {
    TodoItemInput {
        title: "Task".into(),
        category: None,
        notes: Some("不能作为正文真源".into()),
        due_date: None,
        due_at: None,
        completed: false,
        priority: None,
    }
}

fn document(blocks: Vec<TodoNoteBlock>) -> TodoNoteDocument {
    TodoNoteDocument { version: 2, blocks }
}

#[test]
fn document_validation_preserves_code_and_rejects_untrusted_structure() {
    let doc = document(vec![TodoNoteBlock::CodeBlock {
        text: "  <script>代码</script>\n\t".into(),
    }]);
    doc.validate().unwrap();
    assert_eq!(
        doc.plain_text().as_deref(),
        Some("  <script>代码</script>\n\t")
    );
    let invalid = [
        json!({ "version":1,"blocks":[{"type":"html","text":"<b>bad</b>"}] }),
        json!({ "version":1,"blocks":[{"type":"paragraph","text":"x","marks":["bold"]}] }),
        json!({ "version":1,"blocks":[{"type":"image","assetId":"x","src":"https://example.invalid"}] }),
    ];
    for value in invalid {
        assert!(serde_json::from_value::<TodoNoteDocument>(value).is_err());
    }
    assert_eq!(
        TodoNoteDocument {
            version: 9,
            blocks: vec![]
        }
        .validate()
        .unwrap_err()
        .code,
        "todo:note_version"
    );
    assert!(document(vec![TodoNoteBlock::Paragraph {
        content: vec![TodoNoteInline::Text {
            text: "a".repeat(MAX_NOTE_BYTES)
        }]
    }])
    .validate()
    .is_err());
    assert!(document(vec![TodoNoteBlock::Paragraph {
        content: vec![TodoNoteInline::Image {
            asset_id: "file:///private/source.png".into()
        }]
    }])
    .validate()
    .is_err());
}

#[test]
fn saves_document_projection_images_and_first_thumbnail_atomically() {
    let _serial = TEST_LOCK.lock();
    let fixture = Fixture::new();
    let saved = fixture.saved();
    assert_eq!(
        saved.item.notes.as_deref(),
        Some("说明\n第二行\n\n  <div>代码</div>\n\treturn 1;\n")
    );
    assert_eq!(saved.revision, 1);
    assert_eq!(fixture.scalar("SELECT COUNT(*) FROM todo_note_drafts"), 0);
    assert_eq!(
        fixture.scalar("SELECT COUNT(*) FROM todo_note_images WHERE item_id IS NOT NULL"),
        1
    );
    let summary = fixture.repository.note_summaries().unwrap().remove(0);
    assert_eq!(summary.image_count, 1);
    let image = summary.first_image.unwrap();
    assert_eq!(image.id, saved.document.image_ids()[0]);
    let thumb = fixture
        .repository
        .note_image_data(&image.id, Some(&saved.item.id), None, true)
        .unwrap();
    assert!(thumb.image.byte_length <= 50_000);
    assert!(!STANDARD.decode(thumb.data_base64).unwrap().is_empty());
    let reopened = TodoRepository::new(Storage::new(fixture.root.clone()).unwrap())
        .note_details(&saved.item.id)
        .unwrap();
    assert_eq!(reopened.document, saved.document);
    assert_eq!(reopened.item.notes, saved.item.notes);
}

#[test]
fn reads_saved_image_through_item_owned_edit_draft() {
    let _serial = TEST_LOCK.lock();
    let fixture = Fixture::new();
    let saved = fixture.saved();
    let draft = fixture
        .repository
        .begin_note_draft(Some(&saved.item.id))
        .unwrap();
    let image = fixture
        .repository
        .note_image_data(
            saved.document.image_ids()[0],
            Some(&saved.item.id),
            Some(&draft.id),
            false,
        )
        .unwrap();
    assert_eq!(image.image.id, saved.document.image_ids()[0]);
    fixture.repository.close_note_draft(&draft.id).unwrap();
}

#[test]
fn image_only_notes_and_explicit_clear_are_distinct() {
    let _serial = TEST_LOCK.lock();
    let fixture = Fixture::new();
    let draft = fixture.repository.begin_note_draft(None).unwrap();
    let image = fixture.image(&draft.id, 1);
    let saved = fixture
        .service
        .save(TodoNoteSaveInput {
            draft_id: draft.id,
            metadata: metadata(),
            document: document(vec![TodoNoteBlock::Paragraph {
                content: vec![TodoNoteInline::Image { asset_id: image }],
            }]),
        })
        .unwrap();
    assert_eq!(saved.item.notes, None);
    assert_eq!(
        fixture.repository.note_summaries().unwrap()[0].image_count,
        1
    );
    let draft = fixture
        .repository
        .begin_note_draft(Some(&saved.item.id))
        .unwrap();
    let cleared = fixture
        .service
        .save(TodoNoteSaveInput {
            draft_id: draft.id,
            metadata: metadata(),
            document: document(vec![]),
        })
        .unwrap();
    assert_eq!(cleared.item.notes, None);
    assert!(cleared.document.blocks.is_empty());
    assert_eq!(fixture.scalar("SELECT COUNT(*) FROM todo_note_images"), 0);
    assert_eq!(fixture.scalar("SELECT COUNT(*) FROM todo_notes"), 0);
}

#[test]
fn note_save_updates_priority_and_keeps_abandoned() {
    let _serial = TEST_LOCK.lock();
    let fixture = Fixture::new();
    let saved = fixture.saved();
    fixture
        .repository
        .set_abandoned(&saved.item.id, true)
        .unwrap();
    let draft = fixture
        .repository
        .begin_note_draft(Some(&saved.item.id))
        .unwrap();
    let resaved = fixture
        .service
        .save(TodoNoteSaveInput {
            draft_id: draft.id,
            metadata: TodoItemInput {
                priority: Some(TodoPriority::High),
                ..metadata()
            },
            document: document(vec![]),
        })
        .unwrap();
    assert_eq!(resaved.item.priority, Some(TodoPriority::High));
    assert!(
        resaved.item.abandoned,
        "saving a note must not clear abandoned state"
    );
    assert!(resaved.item.abandoned_at.is_some());
}

#[test]
fn cancel_only_deletes_draft_owned_images_and_never_originals() {
    let _serial = TEST_LOCK.lock();
    let fixture = Fixture::new();
    let saved = fixture.saved();
    let draft = fixture
        .repository
        .begin_note_draft(Some(&saved.item.id))
        .unwrap();
    fixture.image(&draft.id, 40);
    let other = fixture.repository.begin_note_draft(None).unwrap();
    fixture.image(&other.id, 60);
    fixture.service.close_draft(&draft.id).unwrap();
    fixture.service.close_draft(&draft.id).unwrap();
    assert_eq!(fixture.scalar("SELECT COUNT(*) FROM todo_note_images"), 2);
    assert_eq!(
        fixture
            .repository
            .note_details(&saved.item.id)
            .unwrap()
            .document,
        saved.document
    );
    assert_eq!(
        fixture
            .repository
            .note_image_data(saved.document.image_ids()[0], None, Some(&draft.id), false)
            .unwrap_err()
            .code,
        "todo:note_draft_closed"
    );
    assert_eq!(
        fixture
            .service
            .import_image(&draft.id, "AA==")
            .unwrap_err()
            .code,
        "todo:note_draft_closed"
    );
}

#[test]
fn save_rejects_foreign_resources_and_keeps_both_drafts_unchanged() {
    let _serial = TEST_LOCK.lock();
    let fixture = Fixture::new();
    let first = fixture.repository.begin_note_draft(None).unwrap();
    let image = fixture.image(&first.id, 1);
    let second = fixture.repository.begin_note_draft(None).unwrap();
    let error = fixture
        .service
        .save(TodoNoteSaveInput {
            draft_id: second.id,
            metadata: metadata(),
            document: document(vec![TodoNoteBlock::Paragraph {
                content: vec![TodoNoteInline::Image { asset_id: image }],
            }]),
        })
        .unwrap_err();
    assert_eq!(error.code, "todo:note_image_missing");
    assert_eq!(fixture.scalar("SELECT COUNT(*) FROM todo_items"), 0);
    assert_eq!(fixture.scalar("SELECT COUNT(*) FROM todo_note_drafts"), 2);
    assert_eq!(fixture.scalar("SELECT COUNT(*) FROM todo_note_images"), 1);
}

#[test]
fn completing_or_metadata_edits_preserve_rich_document_and_reject_stale_editor() {
    let _serial = TEST_LOCK.lock();
    let fixture = Fixture::new();
    let saved = fixture.saved();
    let draft = fixture
        .repository
        .begin_note_draft(Some(&saved.item.id))
        .unwrap();
    fixture
        .repository
        .set_completed(&saved.item.id, true)
        .unwrap();
    let error = fixture
        .service
        .save(TodoNoteSaveInput {
            draft_id: draft.id.clone(),
            metadata: metadata(),
            document: saved.document.clone(),
        })
        .unwrap_err();
    assert_eq!(error.code, "todo:note_conflict");
    assert!(
        fixture
            .repository
            .note_details(&saved.item.id)
            .unwrap()
            .item
            .completed
    );
    assert_eq!(
        fixture
            .repository
            .note_details(&saved.item.id)
            .unwrap()
            .document,
        saved.document
    );
    let mut input = metadata();
    input.notes = saved.item.notes.clone();
    input.title = "Renamed".into();
    fixture
        .repository
        .update(&saved.item.id, input.clone())
        .unwrap();
    input.notes = Some("截断或其他文本".into());
    assert_eq!(
        fixture
            .repository
            .update(&saved.item.id, input)
            .unwrap_err()
            .code,
        "todo:note_conflict"
    );
    assert_eq!(
        fixture
            .repository
            .note_details(&saved.item.id)
            .unwrap()
            .document,
        saved.document
    );
    fixture.repository.delete(&saved.item.id).unwrap();
    assert_eq!(fixture.scalar("SELECT COUNT(*) FROM todo_note_drafts"), 0);
    assert_eq!(fixture.scalar("SELECT COUNT(*) FROM todo_note_images"), 0);
    assert_eq!(
        fixture
            .service
            .save(TodoNoteSaveInput {
                draft_id: draft.id,
                metadata: metadata(),
                document: saved.document
            })
            .unwrap_err()
            .code,
        "todo:note_draft_closed"
    );
}

#[test]
fn copied_images_get_new_ownership_and_reordering_updates_first_image() {
    let _serial = TEST_LOCK.lock();
    let fixture = Fixture::new();
    let saved = fixture.saved();
    let draft = fixture.repository.begin_note_draft(None).unwrap();
    let copied = fixture
        .repository
        .copy_note_image(&draft.id, &saved.item.id, saved.document.image_ids()[0])
        .unwrap();
    assert_ne!(copied.id, saved.document.image_ids()[0]);
    let second = fixture.image(&draft.id, 200);
    let result = fixture
        .service
        .save(TodoNoteSaveInput {
            draft_id: draft.id,
            metadata: metadata(),
            document: document(vec![
                TodoNoteBlock::Paragraph {
                    content: vec![TodoNoteInline::Image {
                        asset_id: second.clone(),
                    }],
                },
                TodoNoteBlock::Paragraph {
                    content: vec![TodoNoteInline::Image {
                        asset_id: copied.id.clone(),
                    }],
                },
            ]),
        })
        .unwrap();
    let draft = fixture
        .repository
        .begin_note_draft(Some(&result.item.id))
        .unwrap();
    fixture
        .service
        .save(TodoNoteSaveInput {
            draft_id: draft.id,
            metadata: metadata(),
            document: document(vec![TodoNoteBlock::Paragraph {
                content: vec![TodoNoteInline::Image {
                    asset_id: copied.id.clone(),
                }],
            }]),
        })
        .unwrap();
    let summary = fixture
        .repository
        .note_summaries()
        .unwrap()
        .into_iter()
        .find(|entry| entry.item_id == result.item.id)
        .unwrap();
    assert_eq!(summary.first_image.unwrap().id, copied.id);
    assert_eq!(summary.image_count, 1);
    assert!(fixture
        .repository
        .note_image_data(&second, Some(&result.item.id), None, false)
        .is_err());
    assert!(fixture
        .repository
        .note_image_data(&copied.id, Some(&saved.item.id), None, false)
        .is_err());
    assert_eq!(fixture.scalar("SELECT COUNT(*) FROM todo_note_images"), 2);
}

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
