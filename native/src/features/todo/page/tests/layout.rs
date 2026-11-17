use super::*;
use gpui_kit::{
    Focusable, MouseButton, point, size,
    test::{TestEventExt, TestQueryExt},
};

#[gpui_kit::test]
fn equal_metadata_columns_and_notes_fill_space_across_presentations(cx: &mut TestAppContext) {
    let _guard = UI_TEST_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let (_root, worker, _database, handle, page) = open(cx, 0);
    cx.update_window(handle.into(), |_, window, cx| {
        window.click("todo-new", cx);
        window.click("task-title", cx);
        window.input("保持表单与历史", cx);
        window.render_frame(cx);
        let category = window.find("task-category-column").bounds();
        let priority = window.find("task-priority-column").bounds();
        let title = window.find("task-title").bounds();
        assert!((category.size.width - priority.size.width).abs() < px(1.));
        assert!((category.left() - title.left()).abs() < px(1.));
        assert!((priority.right() - title.right()).abs() < px(1.));
        assert!(category.right() < priority.left());
        let notes = window.find("rich-text-scroll").bounds();
        assert!(notes.size.height >= gpui_kit::rems(4.).to_pixels(window.rem_size()));
        let point = point(notes.center().x, notes.bottom() - px(16.));
        window.pointer_down(point, MouseButton::Left, cx);
        window.pointer_up(point, MouseButton::Left, cx);
        window.input("正文底部可输入", cx);
        assert_eq!(page.read(cx).notes.read(cx).value(cx), "正文底部可输入");
    })
    .unwrap();
    let before = cx.read(|cx| page.read(cx).notes.read(cx).snapshot(cx));
    let editor = cx.read(|cx| page.read(cx).notes.read(cx).input_id());
    cx.simulate_window_resize(handle.into(), size(px(1440.), px(900.)));
    cx.run_until_parked();
    cx.update_window(handle.into(), |_, window, cx| {
        window.render_frame(cx);
        assert!(page.read(cx).presentation_wide);
        assert!(!page.read(cx).modal_open);
        assert_eq!(page.read(cx).notes.read(cx).input_id(), editor);
        assert_eq!(page.read(cx).notes.read(cx).snapshot(cx), before);
        let notes = window.find("rich-text-scroll").bounds();
        let save = window.find("editor-save").bounds();
        assert!(notes.size.height > px(300.));
        assert!(save.top() - notes.bottom() < px(32.));
        assert_eq!(window.find("task-title").value(), Some("保持表单与历史"));
    })
    .unwrap();
    cx.simulate_window_resize(handle.into(), size(px(720.), px(480.)));
    cx.run_until_parked();
    cx.update_window(handle.into(), |_, window, cx| {
        window.render_frame(cx);
        assert!(page.read(cx).modal_open);
        assert_eq!(page.read(cx).notes.read(cx).snapshot(cx), before);
        assert!(window.find("editor-save").visible());
        assert!(window.find("editor-save").bounds().bottom() <= px(480.));
    })
    .unwrap();
    worker.shutdown().unwrap();
}

#[gpui_kit::test]
fn details_only_render_existing_metadata_and_keep_date_with_tags(cx: &mut TestAppContext) {
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
        cx.update_window(handle.into(), |_, window, cx| {
            window.click(gpui_kit::SharedString::from(format!("todo-row:{id}")), cx)
        })
        .unwrap();
        settle(cx, &page);
        cx.update_window(handle.into(), |_, window, cx| {
            window.render_frame(cx);
            assert!(window.try_find("details-metadata").is_none());
            assert!(window.try_find("details-planned").is_none());
            assert_eq!(
                window.find("details-title").label(),
                Some(record.item().title.as_str())
            );
            window.click("details-close", cx);
        })
        .unwrap();
        settle(cx, &page);
        database
            .conn()
            .unwrap()
            .execute(
                "UPDATE todo_items SET category=?1,due_date=?2 WHERE id=?3",
                rusqlite::params!["Release", "2026-12-01", &id],
            )
            .unwrap();
        cx.update_window(handle.into(), |_, window, cx| {
            page.update(cx, |page, cx| page.reload(window, cx));
        })
        .unwrap();
        settle(cx, &page);
        cx.update_window(handle.into(), |_, window, cx| {
            window.click(gpui_kit::SharedString::from(format!("todo-row:{id}")), cx)
        })
        .unwrap();
        settle(cx, &page);
        cx.update_window(handle.into(), |_, window, cx| {
            window.render_frame(cx);
            let tags = window.find("details-tags").bounds();
            let date = window.find("details-planned");
            assert_eq!(date.label(), Some("2026-12-01"));
            assert!((date.bounds().center().y - tags.center().y).abs() < px(1.));
            assert!(tags.right() < date.bounds().left());
            window.click("details-close", cx);
        })
        .unwrap();
        settle(cx, &page);
        database
            .conn()
            .unwrap()
            .execute("UPDATE todo_items SET due_date=NULL WHERE id=?1", [&id])
            .unwrap();
        cx.update_window(handle.into(), |_, window, cx| {
            page.update(cx, |page, cx| page.reload(window, cx))
        })
        .unwrap();
        settle(cx, &page);
        cx.update_window(handle.into(), |_, window, cx| {
            window.click(gpui_kit::SharedString::from(format!("todo-row:{id}")), cx)
        })
        .unwrap();
        settle(cx, &page);
        cx.update_window(handle.into(), |_, window, cx| {
            window.render_frame(cx);
            assert!(window.find("details-tags").visible());
            assert!(window.try_find("details-planned").is_none());
        })
        .unwrap();
        worker.shutdown().unwrap();
        cx.update_window(handle.into(), |_, window, _| window.remove_window())
            .unwrap();
    }
}

#[gpui_kit::test]
fn filter_menus_are_separate_focus_targets_and_match_longest_option(cx: &mut TestAppContext) {
    let _guard = UI_TEST_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let (_root, worker, _database, handle, page) = open(cx, 0);
    let long_category = "需要完整呈现的分类候选";
    cx.update_window(handle.into(), |_, window, cx| {
        page.read(cx).filters.clone().update(cx, |filters, cx| {
            filters.refresh(
                Locale::Chinese,
                vec!["短".into(), long_category.into()],
                window,
                cx,
            );
        });
        window.render_frame(cx);
        let search = window.find("todo-search").bounds();
        let priority = window.find("filter-priority").bounds();
        let category = window.find("filter-category").bounds();
        assert!(search.right() < priority.left() && priority.right() < category.left());
        assert!((search.center().y - category.center().y).abs() < px(1.));
        assert!(category.size.width > priority.size.width);
        window.click("todo-search", cx);
        assert!(
            page.read(cx)
                .search
                .read(cx)
                .focus_handle(cx)
                .is_focused(window)
        );
        window.click("filter-category", cx);
        window.render_frame(cx);
        assert!(
            !page
                .read(cx)
                .search
                .read(cx)
                .focus_handle(cx)
                .is_focused(window)
        );
        let option = window.find_by_label(long_category).bounds();
        // Menu rows exclude the popup's two 4px content insets.
        assert!(
            option.size.width + gpui_kit::rems(0.5).to_pixels(window.rem_size())
                >= category.size.width
        );
        window.pointer_down(option.center(), MouseButton::Left, cx);
        window.pointer_up(option.center(), MouseButton::Left, cx);
        assert_eq!(
            page.read(cx).filters.read(cx).value(cx).0.as_deref(),
            Some(long_category)
        );
        assert_eq!(page.read(cx).search.read(cx).value().as_ref(), "");
    })
    .unwrap();
    settle(cx, &page);
    worker.shutdown().unwrap();
}
