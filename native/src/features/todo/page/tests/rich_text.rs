use super::*;
use crate::components::rich_text::RichTextDocument;

#[gpui_kit::test]
fn formatted_notes_save_immediately_and_reopen_as_rich_text(cx: &mut TestAppContext) {
    let _guard = UI_TEST_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let (_root, worker, _database, handle, page) = open(cx, 0);
    cx.update_window(handle.into(), |_, window, cx| {
        window.click("todo-new", cx);
        window.click("task-title", cx);
        window.input("富文本集成", cx);
        let input = page.read(cx).notes.read(cx).input_id();
        window.click(input, cx);
        window.input("中文🧩", cx);
        window.press("cmd-a", cx);
        window.click("rich-text-bold", cx);
        window.click("editor-save", cx);
    })
    .unwrap();
    settle(cx, &page);
    let records = block_on(
        worker
            .client()
            .list(TodoView::Active, String::new())
            .unwrap(),
    )
    .unwrap();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].item().notes.as_deref(), Some("中文🧩"));
    let id = records[0].item().id.clone();
    let (_, document) = block_on(worker.client().load_document(id.clone()).unwrap()).unwrap();
    assert!(document.source().contains("**"));
    cx.update_window(handle.into(), |_, window, cx| {
        window.click(gpui_kit::SharedString::from(format!("todo-row:{id}")), cx);
    })
    .unwrap();
    settle(cx, &page);
    cx.update_window(handle.into(), |_, _, cx| {
        assert_eq!(page.read(cx).notes.read(cx).snapshot(cx), document);
    })
    .unwrap();
    worker.shutdown().unwrap();
}

#[gpui_kit::test]
fn undo_to_literal_original_closes_without_a_dirty_prompt_or_document_write(
    cx: &mut TestAppContext,
) {
    let _guard = UI_TEST_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let (_root, worker, database, handle, page) = open(cx, 1);
    let record = block_on(
        worker
            .client()
            .list(TodoView::Active, String::new())
            .unwrap(),
    )
    .unwrap()
    .remove(0);
    let mut input = Draft::edit(&record).input();
    input.notes = Some("# literal **文字**".into());
    block_on(
        worker
            .client()
            .update(record.item().id.clone(), input, record.revision())
            .unwrap(),
    )
    .unwrap();
    cx.update_window(handle.into(), |_, window, cx| {
        window.click(
            gpui_kit::SharedString::from(format!("todo-row:{}", record.item().id)),
            cx,
        );
    })
    .unwrap();
    settle(cx, &page);
    cx.update_window(handle.into(), |_, window, cx| {
        if window.try_find("details-edit").is_some() {
            window.click("details-edit", cx);
        }
        focus_notes(window, cx, &page);
        window.press("cmd-a", cx);
        window.click("rich-text-bold", cx);
        window.press("cmd-z", cx);
        window.click("editor-close", cx);
    })
    .unwrap();
    settle(cx, &page);
    cx.update_window(handle.into(), |_, window, cx| {
        window.render_frame(cx);
        assert!(window.try_find("leave-discard").is_none());
        assert!(window.try_find("todo-editor").is_none());
    })
    .unwrap();
    assert_eq!(
        database
            .conn()
            .unwrap()
            .query_row("SELECT count(*) FROM native_rich_text_notes", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
    worker.shutdown().unwrap();
}

#[gpui_kit::test]
fn formatted_draft_survives_close_and_worker_reopen(cx: &mut TestAppContext) {
    let _guard = UI_TEST_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let (root, worker, _database, handle, page) = open(cx, 0);
    cx.update_window(handle.into(), |_, window, cx| {
        window.click("todo-new", cx);
        window.click("task-title", cx);
        window.input("恢复格式草稿", cx);
        focus_notes(window, cx, &page);
        window.input("待恢复备注", cx);
        window.press("cmd-a", cx);
        window.click("rich-text-italic", cx);
    })
    .unwrap();
    settle(cx, &page);
    assert!(!gpui_kit::VisualTestContext::from_window(handle.into(), cx).simulate_close());
    settle(cx, &page);
    worker.shutdown().unwrap();
    let (reopened, ready) = TodoWorker::start(paths_for(&root)).unwrap();
    block_on(ready).unwrap();
    let draft = block_on(reopened.client().load_session().unwrap())
        .unwrap()
        .draft
        .unwrap();
    assert!(
        draft
            .document
            .unwrap()
            .equivalent(&RichTextDocument::from_markdown("*待恢复备注*"))
    );
    assert!(
        block_on(
            reopened
                .client()
                .list(TodoView::Active, String::new())
                .unwrap()
        )
        .unwrap()
        .is_empty()
    );
    reopened.shutdown().unwrap();
}
