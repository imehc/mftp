#![expect(
    clippy::unwrap_used,
    reason = "Headless fixtures use isolated databases and fail immediately."
)]

use super::*;
use crate::{
    UI_TEST_LOCK, features::todo::TodoWorker, i18n::LanguagePreference,
    preferences::AppearancePreference,
};
use futures::executor::block_on;
use gpui_kit::{
    Bounds, TestAppContext, WindowBounds, WindowHandle, WindowOptions, base::Root, px, size,
    test::TestWindowExt,
};
use mftp_todo::TodoView;
use std::time::Duration;

fn open(
    cx: &mut TestAppContext,
    width: f32,
) -> (
    tempfile::TempDir,
    TodoWorker,
    TodoClient,
    WindowHandle<Root>,
    Entity<Workspace>,
) {
    // The production SQLite worker intentionally runs on a real OS thread.
    cx.executor().allow_parking();
    let root = tempfile::tempdir().unwrap();
    let paths = AppPaths {
        data_dir: root.path().join("native"),
    };
    let (worker, ready) = TodoWorker::start(paths.clone()).unwrap();
    let client = worker.client();
    cx.update(gpui_kit::init);
    let (handle, view) = cx.update(|cx| {
        commands::bind_keys(cx);
        crate::features::todo::page::bind_keys(cx);
        gpui_kit::open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(Bounds::centered(
                    None,
                    size(px(width), px(720.)),
                    cx,
                ))),
                ..Default::default()
            },
            cx,
            |window, cx| cx.new(|cx| Workspace::new(paths, client.clone(), ready, window, cx)),
        )
        .unwrap()
    });
    settle(cx, &view);
    (
        root,
        worker,
        client,
        handle.downcast::<Root>().unwrap(),
        view,
    )
}

fn settle(cx: &mut TestAppContext, view: &Entity<Workspace>) {
    for _ in 0..250 {
        cx.executor().advance_clock(Duration::from_millis(10));
        cx.run_until_parked();
        if cx.update(|cx| {
            let page = view.read(cx).todo.read(cx);
            !page.is_loading() && !page.is_busy()
        }) {
            return;
        }
        std::thread::sleep(Duration::from_millis(2));
    }
    assert!(
        cx.update(|cx| {
            let page = view.read(cx).todo.read(cx);
            !page.is_loading() && !page.is_busy()
        }),
        "The isolated database worker did not settle within 500 ms"
    );
}

#[gpui_kit::test]
fn quit_without_control_focus_preserves_the_draft(cx: &mut TestAppContext) {
    let _guard = UI_TEST_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let (root, worker, _client, handle, view) = open(cx, 1080.);
    cx.update_window(handle.into(), |_, window, cx| {
        window.click("todo-new", cx);
        window.click("task-title", cx);
        window.input("无焦点退出草稿", cx);
        window.click("nav-settings", cx);
        window.blur(cx);
        assert!(window.focused(cx).is_none());
        assert!(cx.is_action_available(&commands::Quit));
        window.press("cmd-q", cx);
    })
    .unwrap();
    settle(cx, &view);
    assert!(cx.read(|cx| cx.windows().is_empty()));
    worker.shutdown().unwrap();
    let (reopened, ready) = TodoWorker::start(AppPaths {
        data_dir: root.path().join("native"),
    })
    .unwrap();
    block_on(ready).unwrap();
    let session = block_on(reopened.client().load_session().unwrap()).unwrap();
    assert_eq!(session.draft.unwrap().title, "无焦点退出草稿");
    reopened.shutdown().unwrap();
}

#[gpui_kit::test]
fn create_complete_restore_and_confirm_delete_through_the_workspace(cx: &mut TestAppContext) {
    let _guard = UI_TEST_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let (_root, worker, client, handle, view) = open(cx, 1080.);
    cx.update_window(handle.into(), |_, window, cx| {
        window.render_frame(cx);
        assert!(window.find("todo-empty").visible());
        window.click("todo-new", cx);
        window.click("task-title", cx);
        window.input("核对发布资料 José", cx);
        window.click("editor-save", cx);
        window.click("editor-save", cx);
    })
    .unwrap();
    settle(cx, &view);
    let records = block_on(client.list(TodoView::Active, String::new()).unwrap()).unwrap();
    assert_eq!(records.len(), 1);
    let id = records[0].item().id.clone();
    cx.update_window(handle.into(), |_, window, cx| {
        window.render_frame(cx);
        assert!(window.try_find("todo-composer").is_none());
        let checkbox = window
            .find(gpui_kit::SharedString::from(format!("todo-complete:{id}")))
            .bounds();
        let title = window
            .find(gpui_kit::SharedString::from(format!("todo-title:{id}")))
            .bounds();
        let more = window
            .find(gpui_kit::SharedString::from(format!("todo-more:{id}")))
            .bounds();
        assert!((checkbox.center().y - title.center().y).abs() < px(1.));
        assert!((title.center().y - more.center().y).abs() < px(1.));
        assert!(checkbox.right() <= title.left() && title.right() <= more.left());
        window.click(
            gpui_kit::SharedString::from(format!("todo-complete:{id}")),
            cx,
        );
    })
    .unwrap();
    settle(cx, &view);
    assert!(
        block_on(client.get(id.clone()).unwrap())
            .unwrap()
            .item()
            .completed
    );
    cx.update_window(handle.into(), |_, window, cx| {
        window.click("nav-completed", cx)
    })
    .unwrap();
    settle(cx, &view);
    cx.update_window(handle.into(), |_, window, cx| {
        window.render_frame(cx);
        window.click(
            gpui_kit::SharedString::from(format!("todo-complete:{id}")),
            cx,
        );
    })
    .unwrap();
    settle(cx, &view);
    assert!(
        !block_on(client.get(id.clone()).unwrap())
            .unwrap()
            .item()
            .completed
    );
    cx.update_window(handle.into(), |_, window, cx| {
        window.click("nav-active", cx)
    })
    .unwrap();
    settle(cx, &view);
    cx.update_window(handle.into(), |_, window, cx| {
        window.render_frame(cx);
        window.click(gpui_kit::SharedString::from(format!("todo-more:{id}")), cx);
    })
    .unwrap();
    settle(cx, &view);
    // The Kit alert uses its semantic confirm and cancel buttons.
    cx.update_window(handle.into(), |_, window, cx| {
        use gpui_kit::test::{TestEventExt, TestQueryExt};
        let label =
            crate::i18n::text("todo.delete", view.read(cx).settings.read(cx).locale()).into_owned();
        let item = window.find_by_label(&label);
        let point = item.bounds().center();
        window.pointer_down(point, gpui_kit::MouseButton::Left, cx);
        window.pointer_up(point, gpui_kit::MouseButton::Left, cx);
    })
    .unwrap();
    settle(cx, &view);
    assert!(block_on(client.get(id.clone()).unwrap()).is_ok());
    cx.update_window(handle.into(), |_, window, cx| window.click("cancel", cx))
        .unwrap();
    settle(cx, &view);
    assert!(block_on(client.get(id.clone()).unwrap()).is_ok());
    cx.update_window(handle.into(), |_, window, cx| {
        window.click(gpui_kit::SharedString::from(format!("todo-row:{id}")), cx);
    })
    .unwrap();
    settle(cx, &view);
    cx.update_window(handle.into(), |_, window, cx| {
        window.press("cmd-backspace", cx)
    })
    .unwrap();
    settle(cx, &view);
    cx.update_window(handle.into(), |_, window, cx| window.click("ok", cx))
        .unwrap();
    settle(cx, &view);
    assert_eq!(
        block_on(client.get(id).unwrap()).unwrap_err().code,
        "todo:item_not_found"
    );
    worker.shutdown().unwrap();
}

#[gpui_kit::test]
fn preferences_retain_the_draft_and_persist_without_a_save_toast(cx: &mut TestAppContext) {
    let _guard = UI_TEST_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let (root, worker, _client, handle, view) = open(cx, 720.);
    cx.update_window(handle.into(), |_, window, cx| {
        window.click("todo-new", cx);
        window.click("task-title", cx);
        window.input("保留的草稿", cx);
        window.click("nav-settings", cx);
    })
    .unwrap();
    settle(cx, &view);
    cx.update_window(handle.into(), |_, window, cx| {
        window.render_frame(cx);
        let settings = view.read(cx).settings.clone();
        settings.update(cx, |settings, cx| {
            settings.set_language(LanguagePreference::English, window, cx)
        });
        settings.update(cx, |settings, cx| {
            settings.set_appearance_preference(AppearancePreference::Dark, window, cx)
        });
    })
    .unwrap();
    settle(cx, &view);
    cx.update_window(handle.into(), |_, window, cx| {
        window.click("nav-active", cx);
        assert_eq!(window.find("task-title").value(), Some("保留的草稿"));
        assert_eq!(window.find("task-title").label(), Some("Task title"));
        assert!(window.try_find("state-error").is_none());
    })
    .unwrap();
    worker.shutdown().unwrap();
    let (reopened, ready) = TodoWorker::start(AppPaths {
        data_dir: root.path().join("native"),
    })
    .unwrap();
    block_on(ready).unwrap();
    let session = block_on(reopened.client().load_session().unwrap()).unwrap();
    assert_eq!(session.preferences.language(), LanguagePreference::English);
    assert_eq!(session.preferences.appearance(), AppearancePreference::Dark);
    assert_eq!(session.draft.unwrap().title, "保留的草稿");
    reopened.shutdown().unwrap();
}

#[gpui_kit::test]
fn edits_notes_resizes_and_resolves_unsaved_changes_through_the_ui(cx: &mut TestAppContext) {
    let _guard = UI_TEST_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let (_root, worker, client, handle, view) = open(cx, 1080.);
    cx.update_window(handle.into(), |_, window, cx| {
        window.click("todo-new", cx);
        window.click("editor-save", cx);
        assert!(window.find("task-title-error").visible());
        assert!(window.try_find("editor-error").is_none());
        window.click("task-title", cx);
        window.input("编辑测试", cx);
        let page = view.read(cx).todo.clone();
        window.scroll(
            "editor-fields",
            gpui_kit::ScrollDelta::Pixels(gpui_kit::point(px(0.), px(-1000.))),
            cx,
        );
        page.update(cx, |page, cx| page.focus_notes_for_test(window, cx));
        window.input("第一行\n第二行", cx);
        window.click("editor-save", cx);
    })
    .unwrap();
    settle(cx, &view);
    let records = block_on(client.list(TodoView::Active, String::new()).unwrap()).unwrap();
    let id = &records[0].item().id;
    assert_eq!(records[0].item().notes.as_deref(), Some("第一行\n第二行"));
    cx.update_window(handle.into(), |_, window, cx| {
        window.click(gpui_kit::SharedString::from(format!("todo-row:{id}")), cx)
    })
    .unwrap();
    settle(cx, &view);
    cx.update_window(handle.into(), |_, window, cx| {
        window.render_frame(cx);
        assert!(window.find("todo-details").bounds().size.width >= px(420.));
        if window.try_find("details-edit").is_some() {
            window.click("details-edit", cx);
        }
        window.click("task-title", cx);
        window.press("cmd-a", cx);
        window.input("调整后的标题", cx);
    })
    .unwrap();
    cx.simulate_window_resize(handle.into(), size(px(720.), px(480.)));
    cx.update_window(handle.into(), |_, window, cx| {
        window.render_frame(cx);
        assert!(window.try_find("todo-search").is_some());
        assert_eq!(window.find("task-title").value(), Some("调整后的标题"));
        use gpui_kit::test::TestQueryExt;
        let label = crate::i18n::text("todo.notes", view.read(cx).settings.read(cx).locale());
        assert_eq!(window.find_by_label(&label).value(), Some("第一行\n第二行"));
        assert!(window.find("editor-save").visible());
        assert!(window.find("editor-save").bounds().right() <= px(720.));
        assert!(window.find("editor-save").bounds().bottom() <= px(480.));
        window.click("editor-cancel", cx);
    })
    .unwrap();
    settle(cx, &view);
    cx.update_window(handle.into(), |_, window, cx| {
        window.click("leave-close", cx)
    })
    .unwrap();
    settle(cx, &view);
    cx.update_window(handle.into(), |_, window, cx| {
        assert_eq!(window.find("task-title").value(), Some("调整后的标题"));
        window.click("editor-cancel", cx);
    })
    .unwrap();
    settle(cx, &view);
    cx.update_window(handle.into(), |_, window, cx| {
        window.click("leave-save", cx)
    })
    .unwrap();
    settle(cx, &view);
    assert_eq!(
        block_on(client.get(id.clone()).unwrap())
            .unwrap()
            .item()
            .title,
        "调整后的标题"
    );
    cx.update_window(handle.into(), |_, window, cx| {
        window.click("todo-new", cx);
        window.click("task-title", cx);
        window.input("待丢弃草稿", cx);
        window.press("escape", cx);
    })
    .unwrap();
    settle(cx, &view);
    cx.update_window(handle.into(), |_, window, cx| {
        window.click("leave-discard", cx)
    })
    .unwrap();
    settle(cx, &view);
    assert_eq!(
        block_on(client.list(TodoView::Active, String::new()).unwrap())
            .unwrap()
            .len(),
        1
    );
    cx.update_window(handle.into(), |_, window, cx| {
        window.click("todo-search", cx);
        window.input("不存在的内容", cx);
    })
    .unwrap();
    settle(cx, &view);
    cx.update_window(handle.into(), |_, window, cx| {
        assert!(window.find("todo-empty").visible());
        window.click("todo-clear-search", cx);
    })
    .unwrap();
    settle(cx, &view);
    cx.update_window(handle.into(), |_, window, _| {
        assert!(
            window
                .find(gpui_kit::SharedString::from(format!("todo-row:{id}")))
                .visible()
        )
    })
    .unwrap();
    worker.shutdown().unwrap();
}
