use super::*;
use gpui_kit::{
    Focusable, MouseButton, SharedString, size,
    test::{TestEventExt, TestQueryExt},
};

fn choose(window: &mut Window, key: &'static str, page: &Entity<TodoPage>, cx: &mut gpui_kit::App) {
    let label = crate::i18n::text(key, page.read(cx).locale());
    let point = window.find_by_label(&label).bounds().center();
    window.pointer_down(point, MouseButton::Left, cx);
    window.pointer_up(point, MouseButton::Left, cx);
}

fn show(
    cx: &mut TestAppContext,
    handle: WindowHandle<Root>,
    page: &Entity<TodoPage>,
    id: &str,
    view: TodoView,
) {
    cx.update_window(handle.into(), |_, window, cx| {
        page.update(cx, |page, cx| {
            page.navigate(Destination::View(view), window, cx)
        })
    })
    .unwrap();
    settle(cx, page);
    cx.update_window(handle.into(), |_, window, cx| {
        window.click(SharedString::from(format!("todo-row:{id}")), cx)
    })
    .unwrap();
    settle(cx, page);
}

#[gpui_kit::test]
fn failed_state_write_preserves_details_and_success_closes_both_presentations(
    cx: &mut TestAppContext,
) {
    let _guard = UI_TEST_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    for width in [720., 1440.] {
        let (_root, worker, database, handle, page) = open(cx, 1);
        let record = block_on(worker.client().list(TodoView::Active, "".into()).unwrap())
            .unwrap()
            .remove(0);
        let id = record.item().id.clone();
        cx.simulate_window_resize(handle.into(), size(px(width), px(720.)));
        show(cx, handle, &page, &id, TodoView::Active);
        let before = cx.read(|cx| page.read(cx).notes.read(cx).snapshot(cx));
        database.conn().unwrap().execute_batch("CREATE TRIGGER deny_detail_status BEFORE UPDATE ON todo_items BEGIN SELECT RAISE(ABORT,'isolated state failure'); END;").unwrap();
        cx.update_window(handle.into(), |_, window, cx| {
            window.click("details-complete", cx)
        })
        .unwrap();
        settle(cx, &page);
        cx.update_window(handle.into(), |_, window, cx| {
            window.render_frame(cx);
            assert!(window.find("details-error").visible());
            assert!(window.find("todo-details").visible());
            assert_ne!(window.find("details-complete").disabled(), Some(true));
            assert_eq!(page.read(cx).notes.read(cx).snapshot(cx), before);
            assert!(
                !page
                    .read(cx)
                    .session
                    .draft
                    .as_ref()
                    .unwrap()
                    .original
                    .as_ref()
                    .unwrap()
                    .completed
            );
        })
        .unwrap();
        assert!(
            !block_on(worker.client().get(id.clone()).unwrap())
                .unwrap()
                .item()
                .completed
        );
        database
            .conn()
            .unwrap()
            .execute_batch("DROP TRIGGER deny_detail_status")
            .unwrap();
        cx.update_window(handle.into(), |_, window, cx| {
            window.click("details-complete", cx);
            window.click("details-complete", cx);
        })
        .unwrap();
        settle(cx, &page);
        cx.update_window(handle.into(), |_, window, cx| {
            window.render_frame(cx);
            assert!(window.try_find("todo-details").is_none());
            assert!(!page.read(cx).modal_open);
            assert!(page.read(cx).session.draft.is_none());
            assert_eq!(page.read(cx).counts, [0, 0, 1, 0]);
            assert!(page.read(cx).new_focus.is_focused(window));
        })
        .unwrap();
        assert!(
            block_on(worker.client().get(id.clone()).unwrap())
                .unwrap()
                .item()
                .completed
        );
        show(cx, handle, &page, &id, TodoView::Completed);
        cx.update_window(handle.into(), |_, window, cx| {
            assert_eq!(
                window.find("details-complete").label(),
                Some(crate::i18n::text("todo.restore", page.read(cx).locale()).as_ref())
            );
            window.click("details-complete", cx);
        })
        .unwrap();
        settle(cx, &page);
        show(cx, handle, &page, &id, TodoView::Active);
        cx.update_window(handle.into(), |_, window, cx| {
            window.click("details-more", cx);
            choose(window, "todo.abandon", &page, cx);
        })
        .unwrap();
        settle(cx, &page);
        let abandoned = block_on(worker.client().get(id.clone()).unwrap()).unwrap();
        assert!(abandoned.item().abandoned && !abandoned.item().completed);
        assert_eq!(cx.read(|cx| page.read(cx).counts), [0, 0, 0, 1]);
        assert!(cx.read(|cx| !page.read(cx).modal_open && page.read(cx).session.draft.is_none()));
        show(cx, handle, &page, &id, TodoView::Abandoned);
        cx.update_window(handle.into(), |_, window, cx| {
            assert!(window.try_find("details-abandon").is_none());
            window.click("details-complete", cx);
        })
        .unwrap();
        settle(cx, &page);
        let restored = block_on(worker.client().get(id).unwrap()).unwrap();
        assert!(!restored.item().abandoned && !restored.item().completed);
        assert!(restored.item().completed_at.is_none() && restored.item().abandoned_at.is_none());
        worker.shutdown().unwrap();
        cx.update_window(handle.into(), |_, window, _| window.remove_window())
            .unwrap();
    }
}

#[gpui_kit::test]
fn list_abandon_menu_uses_abandoned_state_and_info_preserves_timestamps(cx: &mut TestAppContext) {
    let _guard = UI_TEST_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let (_root, worker, _database, handle, page) = open(cx, 1);
    let record = block_on(worker.client().list(TodoView::Active, "".into()).unwrap())
        .unwrap()
        .remove(0);
    let id = record.item().id.clone();
    cx.update_window(handle.into(), |_, window, cx| {
        window.click(SharedString::from(format!("todo-more:{id}")), cx);
        choose(window, "todo.abandon", &page, cx);
    })
    .unwrap();
    settle(cx, &page);
    let saved = block_on(worker.client().get(id.clone()).unwrap()).unwrap();
    assert!(saved.item().abandoned && !saved.item().completed);
    show(cx, handle, &page, &id, TodoView::Abandoned);
    cx.update_window(handle.into(), |_, window, cx| {
        window.click("details-more", cx);
        choose(window, "todo.info", &page, cx);
        window.render_frame(cx);
        let item = saved.item();
        for (key, timestamp) in [
            ("todo.created_at", item.created_at),
            ("todo.updated_at", item.updated_at),
            ("todo.abandoned_at", item.abandoned_at.unwrap()),
        ] {
            let locale = page.read(cx).locale();
            let label = format!(
                "{}: {}",
                crate::i18n::text(key, locale),
                super::super::presentation::timestamp(timestamp, locale)
            );
            assert!(window.find_by_label(&label).visible());
        }
    })
    .unwrap();
    worker.shutdown().unwrap();
}

#[gpui_kit::test]
fn detail_delete_cancel_and_failure_preserve_content_until_success(cx: &mut TestAppContext) {
    let _guard = UI_TEST_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    for width in [720., 1440.] {
        let (_root, worker, database, handle, page) = open(cx, 2);
        let records = block_on(worker.client().list(TodoView::Active, "".into()).unwrap()).unwrap();
        let id = records[0].item().id.clone();
        let remaining = records[1].item().id.clone();
        cx.simulate_window_resize(handle.into(), size(px(width), px(720.)));
        show(cx, handle, &page, &id, TodoView::Active);
        let before = cx.read(|cx| page.read(cx).notes.read(cx).snapshot(cx));
        cx.update_window(handle.into(), |_, window, cx| {
            window.click("details-more", cx);
            choose(window, "todo.delete", &page, cx);
        })
        .unwrap();
        settle(cx, &page);
        cx.update_window(handle.into(), |_, window, cx| window.click("cancel", cx))
            .unwrap();
        settle(cx, &page);
        assert!(block_on(worker.client().get(id.clone()).unwrap()).is_ok());
        database.conn().unwrap().execute_batch("CREATE TRIGGER deny_detail_delete BEFORE DELETE ON todo_items BEGIN SELECT RAISE(ABORT,'isolated delete failure'); END;").unwrap();
        cx.update_window(handle.into(), |_, window, cx| {
            window.click("details-more", cx);
            choose(window, "todo.delete", &page, cx);
        })
        .unwrap();
        settle(cx, &page);
        cx.update_window(handle.into(), |_, window, cx| window.click("ok", cx))
            .unwrap();
        settle(cx, &page);
        cx.update_window(handle.into(), |_, window, cx| {
            window.render_frame(cx);
            assert!(window.find("todo-details").visible());
            assert!(window.find("details-error").visible());
            assert_eq!(page.read(cx).notes.read(cx).snapshot(cx), before);
            assert_eq!(page.read(cx).counts, [2, 0, 0, 0]);
        })
        .unwrap();
        assert!(block_on(worker.client().get(id.clone()).unwrap()).is_ok());
        database
            .conn()
            .unwrap()
            .execute_batch("DROP TRIGGER deny_detail_delete")
            .unwrap();
        cx.update_window(handle.into(), |_, window, cx| {
            window.click("details-more", cx);
            choose(window, "todo.delete", &page, cx);
        })
        .unwrap();
        settle(cx, &page);
        cx.update_window(handle.into(), |_, window, cx| window.click("ok", cx))
            .unwrap();
        settle(cx, &page);
        cx.update_window(handle.into(), |_, window, cx| {
            window.render_frame(cx);
            assert!(window.try_find("todo-details").is_none());
            assert!(!page.read(cx).modal_open);
            assert_eq!(page.read(cx).counts, [1, 0, 0, 0]);
            assert!(
                page.read(cx)
                    .rows
                    .read(cx)
                    .focus_handle(cx)
                    .is_focused(window)
            );
            assert_eq!(
                page.read(cx)
                    .rows
                    .read(cx)
                    .delegate()
                    .selected_id
                    .as_deref(),
                Some(remaining.as_str())
            );
        })
        .unwrap();
        assert_eq!(
            block_on(worker.client().get(id).unwrap()).unwrap_err().code,
            "todo:item_not_found"
        );
        assert!(block_on(worker.client().get(remaining).unwrap()).is_ok());
        worker.shutdown().unwrap();
        cx.update_window(handle.into(), |_, window, _| window.remove_window())
            .unwrap();
    }
}
