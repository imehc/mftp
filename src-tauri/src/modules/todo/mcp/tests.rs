use std::{collections::BTreeMap, io::Cursor, sync::Arc};

use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};

use super::*;
use crate::{
    core::{
        activity::{ActivitySink, OperationContext},
        operations::Operations,
    },
    modules::mcp::{access::ModuleGrant, registry::Registry},
};

struct NoLog;

impl ActivitySink for NoLog {
    fn record(&self, _: &OperationContext, _: Option<&AppError>) -> AppResult<()> {
        Ok(())
    }
}

struct Fixture {
    notes: super::super::note_tests::Fixture,
    registry: Registry,
    context: Arc<TodoContext>,
}

impl Fixture {
    fn new() -> Self {
        let notes = super::super::note_tests::Fixture::new();
        let context = TodoContext::new(
            notes.repository.clone(),
            Arc::new(TodoNoteService::new(notes.repository.clone())),
            Executor::new(Arc::new(NoLog), Arc::new(Operations::default())),
        );
        let registry = crate::app::registry::mcp::build(context.clone()).unwrap();
        Self {
            notes,
            registry,
            context,
        }
    }

    async fn call(&self, name: &str, input: Value) -> Value {
        self.as_subject("one", name, input).await
    }

    async fn as_subject(&self, subject: &str, name: &str, input: Value) -> Value {
        let result = self
            .registry
            .call(caller(subject), name, input)
            .await
            .unwrap();
        assert_eq!(result.is_error, Some(false), "{result:?}");
        result.structured_content.unwrap()
    }

    async fn begin(&self, id: Option<&str>) -> String {
        self.call("todo_note_draft_begin", json!({"itemId":id}))
            .await["draft"]["id"]
            .as_str()
            .unwrap()
            .into()
    }

    async fn error(&self, subject: &str, name: &str, input: Value) -> String {
        let result = self
            .registry
            .call(caller(subject), name, input)
            .await
            .unwrap();
        assert_eq!(result.is_error, Some(true));
        result.structured_content.unwrap()["error"]["code"]
            .as_str()
            .unwrap()
            .into()
    }
}

async fn serial_test(operation: impl std::future::Future<Output = ()> + Send + 'static) {
    tokio::task::spawn_blocking(move || {
        let _serial = super::super::note_tests::TEST_LOCK.lock();
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(operation);
    })
    .await
    .unwrap();
}

fn caller(subject: &str) -> Caller {
    Caller::new(
        subject.into(),
        BTreeMap::from([(
            "todo".into(),
            ModuleGrant {
                read: true,
                write: true,
                delete: true,
            },
        )]),
    )
}

fn metadata() -> Value {
    json!({"title":"图文待办","completed":false,"category":"测试","priority":"high"})
}

fn document(image: &str) -> Value {
    json!({"version":2,"blocks":[{"type":"paragraph","content":[
        {"type":"text","text":"图片前"},{"type":"image","assetId":image},{"type":"hardBreak"},{"type":"text","text":"图片后"}
    ]},{"type":"codeBlock","text":"  return 1;\n"}]})
}

fn image_bytes() -> String {
    let image = image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
        12,
        8,
        image::Rgba([20, 0, 0, 128]),
    ));
    let mut output = Cursor::new(Vec::new());
    image
        .write_to(&mut output, image::ImageFormat::Png)
        .unwrap();
    STANDARD.encode(output.into_inner())
}

#[tokio::test]
async fn full_image_text_document_round_trips_and_returns_real_image_content() {
    serial_test(async {
        let fixture = Fixture::new();
        assert_eq!(fixture.registry.list(&caller("one")).len(), 16);
        let draft = fixture.begin(None).await;
        let imported = fixture
            .call(
                "todo_note_image_import",
                json!({"draftId":draft,"dataBase64":image_bytes(),"mimeType":"image/png"}),
            )
            .await;
        let image = imported["image"]["id"].as_str().unwrap();
        let doc = document(image);
        let saved = fixture
            .call(
                "todo_note_save",
                json!({"draftId":draft,"metadata":metadata(),"document":doc}),
            )
            .await;
        assert_eq!(saved["document"], doc);
        let id = saved["item"]["id"].as_str().unwrap();
        let read = fixture.call("todo_get", json!({"id":id})).await;
        assert_eq!(read["document"], doc);
        let image_result = fixture
            .registry
            .call(
                caller("one"),
                "todo_note_image_read",
                json!({"itemId":id,"assetId":image}),
            )
            .await
            .unwrap();
        let content = serde_json::to_value(&image_result.content[0]).unwrap();
        assert_eq!(content["type"], "image");
        assert_eq!(content["mimeType"], "image/png");
        assert!(!STANDARD
            .decode(content["data"].as_str().unwrap())
            .unwrap()
            .is_empty());
        assert!(!image_result
            .structured_content
            .unwrap()
            .to_string()
            .contains("dataBase64"));
        fixture.context.close_all().unwrap();
    })
    .await;
}

#[tokio::test]
async fn another_credential_cannot_read_write_close_or_copy_a_draft() {
    serial_test(async {
        let fixture = Fixture::new();
        let draft = fixture.begin(None).await;
        for (name, input) in [
            ("todo_note_draft_get", json!({"draftId":draft})),
            ("todo_note_draft_close", json!({"draftId":draft})),
            (
                "todo_note_image_import",
                json!({"draftId":draft,"dataBase64":image_bytes(),"mimeType":"image/png"}),
            ),
            (
                "todo_note_save",
                json!({"draftId":draft,"metadata":metadata(),"document":{"version":2,"blocks":[]}}),
            ),
            (
                "todo_note_image_read",
                json!({"draftId":draft,"assetId":uuid::Uuid::new_v4().to_string()}),
            ),
            (
                "todo_note_image_discard",
                json!({"draftId":draft,"assetId":uuid::Uuid::new_v4().to_string()}),
            ),
            (
                "todo_note_image_copy",
                json!({"draftId":draft,"sourceItemId":"none","assetId":"none"}),
            ),
        ] {
            assert_eq!(
                fixture.error("two", name, input).await,
                "todo:note_draft_closed"
            );
        }
        assert_eq!(
            fixture
                .notes
                .scalar("SELECT COUNT(*) FROM todo_note_drafts"),
            1
        );
        fixture.context.close_all().unwrap();
    })
    .await;
}

#[tokio::test]
async fn patch_preserves_document_and_distinguishes_missing_from_null() {
    serial_test(async {
    let fixture = Fixture::new();
    let saved = fixture.notes.saved();
    fixture
        .notes
        .repository
        .update(
            &saved.item.id,
            TodoItemInput {
                title: saved.item.title.clone(),
                category: Some("keep".into()),
                notes: saved.item.notes.clone(),
                due_date: Some("2026-10-22".into()),
                due_at: None,
                completed: false,
                priority: Some(super::super::model::TodoPriority::High),
            },
        )
        .unwrap();
    let current = fixture
        .notes
        .repository
        .note_details(&saved.item.id)
        .unwrap();
    fixture.call("todo_update", json!({"id":saved.item.id,"revision":current.revision,"title":"新标题","category":null})).await;
    let updated = fixture
        .notes
        .repository
        .note_details(&saved.item.id)
        .unwrap();
    assert_eq!(updated.item.category, None);
    assert_eq!(updated.item.due_date.as_deref(), Some("2026-10-22"));
    assert_eq!(
        updated.item.priority,
        Some(super::super::model::TodoPriority::High)
    );
    assert_eq!(updated.document, saved.document);
    assert_eq!(
        fixture
            .error(
                "one",
                "todo_delete",
                json!({"id":saved.item.id,"revision":current.revision})
            )
            .await,
        "todo:note_conflict"
    );
    }).await;
}

#[tokio::test]
async fn conflicting_save_preserves_existing_and_uncommitted_images() {
    serial_test(async {
    let fixture = Fixture::new();
    let saved = fixture.notes.saved();
    let draft = fixture.begin(Some(&saved.item.id)).await;
    let image = fixture
        .call(
            "todo_note_image_import",
            json!({"draftId":draft,"dataBase64":image_bytes(),"mimeType":"image/png"}),
        )
        .await;
    fixture
        .notes
        .repository
        .set_completed(&saved.item.id, true)
        .unwrap();
    let code = fixture.error("one", "todo_note_save", json!({"draftId":draft,"metadata":metadata(),"document":document(image["image"]["id"].as_str().unwrap())})).await;
    assert_eq!(code, "todo:note_conflict");
    assert_eq!(
        fixture
            .notes
            .scalar("SELECT COUNT(*) FROM todo_note_images"),
        2
    );
    fixture.context.close_all().unwrap();
    assert_eq!(
        fixture
            .notes
            .scalar("SELECT COUNT(*) FROM todo_note_images"),
        1
    );
    assert_eq!(
        fixture
            .notes
            .repository
            .note_details(&saved.item.id)
            .unwrap()
            .document,
        saved.document
    );
    }).await;
}

#[tokio::test]
async fn replacing_removing_copying_and_discarding_images_preserves_ownership() {
    serial_test(async {
    let fixture = Fixture::new();
    let saved = fixture.notes.saved();
    let source_image = saved.document.image_ids()[0];
    let draft = fixture.begin(None).await;
    let copied = fixture
        .call(
            "todo_note_image_copy",
            json!({"draftId":draft,"sourceItemId":saved.item.id,"assetId":source_image}),
        )
        .await;
    let copied_id = copied["id"].as_str().unwrap();
    assert_ne!(source_image, copied_id);
    fixture
        .call(
            "todo_note_image_discard",
            json!({"draftId":draft,"assetId":copied_id}),
        )
        .await;
    assert_eq!(
        fixture
            .notes
            .scalar("SELECT COUNT(*) FROM todo_note_images"),
        1
    );
    fixture.context.close_subject("one").unwrap();
    let edit = fixture.begin(Some(&saved.item.id)).await;
    let imported = fixture
        .call(
            "todo_note_image_import",
            json!({"draftId":edit,"dataBase64":image_bytes(),"mimeType":"image/png"}),
        )
        .await;
    fixture.call("todo_note_save", json!({"draftId":edit,"metadata":metadata(),"document":document(imported["image"]["id"].as_str().unwrap())})).await;
    assert_eq!(
        fixture
            .notes
            .scalar("SELECT COUNT(*) FROM todo_note_images"),
        1
    );
    let edit = fixture.begin(Some(&saved.item.id)).await;
    fixture
        .call(
            "todo_note_save",
            json!({"draftId":edit,"metadata":metadata(),"document":{"version":2,"blocks":[]}}),
        )
        .await;
    assert_eq!(
        fixture
            .notes
            .scalar("SELECT COUNT(*) FROM todo_note_images"),
        0
    );
    fixture.context.close_all().unwrap();
    }).await;
}

#[tokio::test]
async fn mime_mismatch_and_invalid_references_do_not_commit_or_leak() {
    serial_test(async {
    let fixture = Fixture::new();
    let draft = fixture.begin(None).await;
    assert_eq!(
        fixture
            .error(
                "one",
                "todo_note_image_import",
                json!({"draftId":draft,"dataBase64":image_bytes(),"mimeType":"image/jpeg"})
            )
            .await,
        "todo:note_image_invalid"
    );
    assert_eq!(
        fixture
            .notes
            .scalar("SELECT COUNT(*) FROM todo_note_images"),
        0
    );
    let foreign = fixture.notes.saved();
    assert_eq!(fixture.error("one", "todo_note_save", json!({"draftId":draft,"metadata":metadata(),"document":document(foreign.document.image_ids()[0])})).await, "todo:note_image_missing");
    assert_eq!(fixture.notes.repository.list().unwrap().len(), 1);
    fixture.context.close_all().unwrap();
    }).await;
}

#[tokio::test]
async fn image_text_save_preserves_completed_abandoned_exclusion() {
    serial_test(async {
        let fixture = Fixture::new();
        let saved = fixture.notes.saved();
        fixture
            .notes
            .repository
            .set_abandoned(&saved.item.id, true)
            .unwrap();
        let draft = fixture.begin(Some(&saved.item.id)).await;
        let mut input = metadata();
        input["completed"] = json!(true);
        let result = fixture
            .call(
                "todo_note_save",
                json!({"draftId":draft,"metadata":input,"document":saved.document}),
            )
            .await;
        assert_eq!(result["item"]["completed"], true);
        assert_eq!(result["item"]["abandoned"], false);
        assert_eq!(result["item"]["abandonedAt"], Value::Null);
        fixture.context.close_all().unwrap();
    })
    .await;
}

#[tokio::test]
async fn subject_quota_and_cleanup_do_not_touch_local_or_other_subject_drafts() {
    serial_test(async {
        let fixture = Fixture::new();
        let local = fixture.notes.repository.begin_note_draft(None).unwrap();
        fixture.begin(None).await;
        fixture.begin(None).await;
        assert_eq!(
            fixture
                .error("one", "todo_note_draft_begin", json!({}))
                .await,
            "todo:note_draft_limit"
        );
        fixture
            .as_subject("two", "todo_note_draft_begin", json!({}))
            .await;
        fixture.registry.close_subject("one").unwrap();
        assert_eq!(
            fixture
                .notes
                .scalar("SELECT COUNT(*) FROM todo_note_drafts"),
            2
        );
        fixture.registry.shutdown().unwrap();
        assert_eq!(
            fixture
                .notes
                .scalar("SELECT COUNT(*) FROM todo_note_drafts"),
            1
        );
        fixture
            .notes
            .repository
            .close_note_draft(&local.id)
            .unwrap();
        assert_eq!(
            fixture
                .error("one", "todo_note_draft_begin", json!({}))
                .await,
            "todo:note_draft_closed"
        );
    })
    .await;
}

#[tokio::test]
async fn pagination_filters_status_and_never_returns_rich_notes() {
    serial_test(async {
        let fixture = Fixture::new();
        let first = fixture.notes.saved();
        let second = fixture.notes.saved();
        fixture
            .notes
            .repository
            .set_completed(&second.item.id, true)
            .unwrap();
        let third = fixture.notes.saved();
        fixture
            .notes
            .repository
            .set_abandoned(&third.item.id, true)
            .unwrap();
        let active = fixture.call("todo_list", json!({})).await;
        assert_eq!(active["items"].as_array().unwrap().len(), 1);
        assert_eq!(active["items"][0]["item"]["id"], first.item.id);
        assert_eq!(active["items"][0]["item"]["notes"], Value::Null);
        let all = fixture
            .call("todo_list", json!({"status":"all","limit":2}))
            .await;
        assert_eq!(all["nextOffset"], 2);
        let rest = fixture
            .call("todo_list", json!({"status":"all","limit":2,"offset":2}))
            .await;
        assert_eq!(rest["items"].as_array().unwrap().len(), 1);
        assert_eq!(rest["nextOffset"], Value::Null);
        assert_eq!(
            fixture
                .error("one", "todo_list", json!({"limit":101}))
                .await,
            "todo:note_invalid"
        );
    })
    .await;
}

#[tokio::test]
async fn revision_guard_allows_only_one_concurrent_writer_and_rejects_null_title() {
    serial_test(async {
        let fixture = Fixture::new();
        let saved = fixture.notes.saved();
        let arguments = json!({"id":saved.item.id,"revision":saved.revision,"value":true});
        let (left, right) = tokio::join!(
            fixture
                .registry
                .call(caller("one"), "todo_set_completed", arguments.clone()),
            fixture
                .registry
                .call(caller("two"), "todo_set_abandoned", arguments),
        );
        let outcomes = [left.unwrap(), right.unwrap()];
        assert_eq!(
            outcomes
                .iter()
                .filter(|result| result.is_error == Some(false))
                .count(),
            1
        );
        assert_eq!(
            outcomes
                .iter()
                .filter(|result| result.is_error == Some(true))
                .count(),
            1
        );
        let latest = fixture
            .notes
            .repository
            .note_details(&saved.item.id)
            .unwrap();
        assert!(!(latest.item.completed && latest.item.abandoned));
        assert_eq!(
            fixture
                .error(
                    "one",
                    "todo_update",
                    json!({"id":saved.item.id,"revision":latest.revision,"title":null})
                )
                .await,
            "todo:title_required"
        );
    })
    .await;
}
