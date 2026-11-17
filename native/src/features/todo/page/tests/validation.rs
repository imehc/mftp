use super::*;

#[gpui_kit::test]
fn empty_title_error_stays_with_the_title_until_the_title_is_valid(cx: &mut TestAppContext) {
    let _guard = UI_TEST_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let (_root, worker, _database, handle, page) = open(cx, 0);
    cx.simulate_window_resize(handle.into(), gpui_kit::size(px(720.), px(480.)));
    cx.update_window(handle.into(), |_, window, cx| {
        window.click("todo-new", cx);
        window.click("editor-save", cx);
        window.render_frame(cx);
        let title = window.find("task-title").bounds();
        let error = window.find("task-title-error").bounds();
        let field = window.find("task-title-field").bounds();
        let notes_action = window
            .find(page.read(cx).notes.read(cx).input_id())
            .bounds();
        assert!(error.top() >= title.bottom() && error.bottom() <= notes_action.top());
        assert!(field.contains(&error.center()));
        assert_eq!(window.find("task-title").focused(), Some(true));
        assert!(window.try_find("editor-error").is_none());
        assert!(!page.read(cx).busy);
        window.input("   ", cx);
        window.scroll(
            "editor-fields",
            gpui_kit::ScrollDelta::Pixels(gpui_kit::point(px(0.), px(-180.))),
            cx,
        );
        focus_notes(window, cx, &page);
        window.input("备注不会让空标题错误消失", cx);
    })
    .unwrap();
    settle(cx, &page);
    cx.update_window(handle.into(), |_, window, cx| {
        window.render_frame(cx);
        if !window.find("task-title-error").visible() {
            window.scroll(
                "editor-fields",
                gpui_kit::ScrollDelta::Pixels(gpui_kit::point(px(0.), px(1000.))),
                cx,
            );
        }
        assert!(window.find("task-title-error").visible());
        assert!(window.try_find("editor-error").is_none());
        if window.try_find("details-edit").is_some() {
            window.click("details-edit", cx);
        }
        if !window.find("task-title").visible() {
            window.scroll(
                "editor-fields",
                gpui_kit::ScrollDelta::Pixels(gpui_kit::point(px(0.), px(1000.))),
                cx,
            );
        }
        window.click("task-title", cx);
        window.press("cmd-a", cx);
        window.input("有效标题", cx);
    })
    .unwrap();
    settle(cx, &page);
    cx.update_window(handle.into(), |_, window, cx| {
        window.render_frame(cx);
        assert!(window.try_find("task-title-error").is_none());
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
    assert_eq!(
        records
            .iter()
            .map(|record| (record.item().title.as_str(), record.item().notes.as_deref()))
            .collect::<Vec<_>>(),
        vec![("有效标题", Some("备注不会让空标题错误消失"))]
    );
    worker.shutdown().unwrap();
}

#[gpui_kit::test]
fn editor_title_validation_preserves_the_record_and_draft(cx: &mut TestAppContext) {
    let _guard = UI_TEST_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let (_root, worker, _database, handle, page) = open(cx, 1);
    let record = block_on(
        worker
            .client()
            .list(TodoView::Active, String::new())
            .unwrap(),
    )
    .unwrap()
    .remove(0);
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
        if !window.find("task-title").visible() {
            window.scroll(
                "editor-fields",
                gpui_kit::ScrollDelta::Pixels(gpui_kit::point(px(0.), px(1000.))),
                cx,
            );
        }
        window.click("task-title", cx);
        window.press("cmd-a", cx);
        window.press("backspace", cx);
        window.click("editor-save", cx);
        window.render_frame(cx);
        let title = window.find("task-title").bounds();
        let error = window.find("task-title-error").bounds();
        let notes = window
            .find(page.read(cx).notes.read(cx).input_id())
            .bounds();
        assert!(error.top() >= title.bottom() && error.bottom() <= notes.top());
        assert!(window.try_find("editor-error").is_none());
        assert_eq!(window.find("task-title").focused(), Some(true));
        focus_notes(window, cx, &page);
        window.input("保留未保存备注", cx);
    })
    .unwrap();
    settle(cx, &page);
    cx.update_window(handle.into(), |_, window, cx| {
        window.render_frame(cx);
        if !window.find("task-title-error").visible() {
            window.scroll(
                "editor-fields",
                gpui_kit::ScrollDelta::Pixels(gpui_kit::point(px(0.), px(1000.))),
                cx,
            );
        }
        assert!(window.find("task-title-error").visible());
        let draft = page.read(cx).session.draft.as_ref().unwrap();
        assert_eq!(
            (draft.title.as_str(), draft.notes.as_str()),
            ("", "保留未保存备注")
        );
        assert!(!page.read(cx).busy);
    })
    .unwrap();
    let saved = block_on(worker.client().get(record.item().id.clone()).unwrap()).unwrap();
    assert_eq!(
        (
            saved.item().title.as_str(),
            saved.item().notes.as_deref(),
            saved.revision()
        ),
        (
            record.item().title.as_str(),
            record.item().notes.as_deref(),
            record.revision()
        )
    );
    worker.shutdown().unwrap();
}
