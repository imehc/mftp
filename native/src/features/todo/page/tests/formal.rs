use super::*;
use gpui_kit::{ClipboardItem, Image, ImageFormat};

#[gpui_kit::test]
fn save_decision_keeps_failed_write_visible_and_only_closes_after_commit(cx: &mut TestAppContext) {
    let _guard = UI_TEST_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let (_root, worker, database, handle, page) = open(cx, 0);
    cx.update_window(handle.into(), |_, window, cx| {
        window.click("todo-new", cx);
        window.click("task-title", cx);
        window.input("确实提交的任务", cx);
        window.click("editor-cancel", cx);
        window.render_frame(cx);
        assert!(window.try_find("leave-cancel").is_none());
        assert!(window.find("leave-save").visible());
    })
    .unwrap();
    database.conn().unwrap().execute_batch("CREATE TRIGGER deny_formal_save BEFORE INSERT ON todo_items BEGIN SELECT RAISE(ABORT,'isolated write failure'); END;").unwrap();
    cx.update_window(handle.into(), |_, window, cx| {
        window.click("leave-save", cx)
    })
    .unwrap();
    settle(cx, &page);
    cx.update_window(handle.into(), |_, window, cx| {
        window.render_frame(cx);
        assert!(window.find("leave-save").visible());
        assert!(page.read(cx).write_error.is_some());
        assert_eq!(
            page.read(cx).session.draft.as_ref().unwrap().title,
            "确实提交的任务"
        );
    })
    .unwrap();
    assert!(
        block_on(worker.client().list(TodoView::Active, "".into()).unwrap())
            .unwrap()
            .is_empty()
    );
    database
        .conn()
        .unwrap()
        .execute_batch("DROP TRIGGER deny_formal_save")
        .unwrap();
    cx.update_window(handle.into(), |_, window, cx| {
        window.click("leave-save", cx)
    })
    .unwrap();
    settle(cx, &page);
    cx.update_window(handle.into(), |_, window, cx| {
        window.render_frame(cx);
        assert!(window.try_find("leave-save").is_none());
        assert!(page.read(cx).session.draft.is_none());
    })
    .unwrap();
    assert_eq!(
        block_on(worker.client().list(TodoView::Active, "".into()).unwrap()).unwrap()[0]
            .item()
            .title,
        "确实提交的任务"
    );
    worker.shutdown().unwrap();
}

#[gpui_kit::test]
fn complete_fields_commit_and_reopen_as_reading_details(cx: &mut TestAppContext) {
    let _guard = UI_TEST_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let (_root, worker, _database, handle, page) = open(cx, 0);
    cx.update_window(handle.into(), |_, window, cx| {
        window.click("todo-new", cx);
        window.click("task-title", cx);
        window.input("完整任务", cx);
        window.click("task-category", cx);
        window.input("工作", cx);
        let fields = page.read(cx).fields.clone();
        fields.update(cx, |fields, cx| {
            fields.set_value(
                super::super::super::metadata::Metadata {
                    category: "工作".into(),
                    priority: Some(mftp_todo::model::TodoPriority::High),
                    date: Some("2099-11-17".into()),
                    time: Some("09:30".into()),
                    instant: None,
                },
                window,
                cx,
            )
        });
        window.click("editor-save", cx);
    })
    .unwrap();
    settle(cx, &page);
    let record = block_on(worker.client().list(TodoView::Active, "".into()).unwrap())
        .unwrap()
        .remove(0);
    assert_eq!(record.item().category.as_deref(), Some("工作"));
    assert_eq!(
        record.item().priority,
        Some(mftp_todo::model::TodoPriority::High)
    );
    assert_eq!(record.item().due_date.as_deref(), Some("2099-11-17"));
    assert!(record.item().due_at.is_some());
    cx.update_window(handle.into(), |_, window, cx| {
        window.click(
            gpui_kit::SharedString::from(format!("todo-row:{}", record.item().id)),
            cx,
        )
    })
    .unwrap();
    settle(cx, &page);
    cx.update_window(handle.into(), |_, window, cx| {
        window.render_frame(cx);
        assert!(window.find("todo-details").visible());
        assert!(window.try_find("task-title").is_none());
        assert!(window.try_find("rich-text-bold").is_none());
        window.click("details-more", cx);
        use gpui_kit::test::{TestEventExt, TestQueryExt};
        let label = crate::i18n::text("todo.abandon", page.read(cx).locale());
        let point = window.find_by_label(&label).bounds().center();
        window.pointer_down(point, gpui_kit::MouseButton::Left, cx);
        window.pointer_up(point, gpui_kit::MouseButton::Left, cx);
    })
    .unwrap();
    settle(cx, &page);
    cx.update_window(handle.into(), |_, window, cx| {
        window.render_frame(cx);
        assert!(window.try_find("todo-details").is_none());
        assert!(!page.read(cx).modal_open);
    })
    .unwrap();
    let saved = block_on(worker.client().get(record.item().id.clone()).unwrap()).unwrap();
    assert!(saved.item().abandoned && !saved.item().completed);
    assert!(saved.item().abandoned_at.is_some());
    assert_eq!(
        block_on(
            worker
                .client()
                .list(TodoView::Abandoned, "".into())
                .unwrap()
        )
        .unwrap()
        .len(),
        1
    );
    worker.shutdown().unwrap();
}

#[gpui_kit::test]
fn oversized_paste_shows_top_center_notice_without_changing_text_or_resources(
    cx: &mut TestAppContext,
) {
    let _guard = UI_TEST_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let (_root, worker, database, handle, page) = open(cx, 0);
    cx.update_window(handle.into(), |_, window, cx| {
        window.click("todo-new", cx);
        window.click("task-title", cx);
        window.input("图片限制", cx);
        focus_notes(window, cx, &page);
        window.input("保留正文", cx);
        let before = page.read(cx).notes.read(cx).snapshot(cx);
        cx.write_to_clipboard(ClipboardItem::new_image(&Image::from_bytes(
            ImageFormat::Png,
            vec![0; 20 * 1024 * 1024 + 1],
        )));
        window.press("cmd-v", cx);
        window.render_frame(cx);
        assert_eq!(page.read(cx).notes.read(cx).snapshot(cx), before);
        assert!(!page.read(cx).notes.read(cx).has_pending_images());
        assert!(window.try_find("rich-text-error").is_none());
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle.into(), |_, window, cx| {
        window.render_frame(cx);
        let stack = window.find(("notification-list", 1usize)).bounds();
        assert!((stack.center().x - window.viewport_size().width / 2.).abs() < px(2.));
        assert!(stack.top() < window.viewport_size().height / 3.);
    })
    .unwrap();
    assert_eq!(
        database
            .conn()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM native_note_images", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
    worker.shutdown().unwrap();
}
