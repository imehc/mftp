#![expect(
    clippy::unwrap_used,
    reason = "Production UI tests use isolated databases."
)]

use super::*;
use crate::{
    UI_TEST_LOCK,
    features::todo::{TodoWorker, database::TodoDatabase},
    platform::AppPaths,
};
use futures::executor::block_on;
use gpui_kit::{
    ElementInputHandler, TestAppContext, WindowHandle,
    base::Root,
    px,
    test::{TestInput, TestWindowExt},
};
use mftp_todo::Database;
use std::time::Duration;

mod formal;
mod images;
mod layout;
mod rich_text;
mod states;
mod validation;

fn open(
    cx: &mut TestAppContext,
    count: usize,
) -> (
    tempfile::TempDir,
    TodoWorker,
    TodoDatabase,
    WindowHandle<Root>,
    Entity<TodoPage>,
) {
    cx.executor().allow_parking();
    let root = tempfile::tempdir().unwrap();
    let paths = AppPaths {
        data_dir: root.path().join("native"),
    };
    let database = TodoDatabase::open(&paths).unwrap();
    let mut conn = database.conn().unwrap();
    let tx = conn.transaction().unwrap();
    {
        let mut insert = tx
            .prepare("INSERT INTO todo_items(id,title,created_at,updated_at) VALUES(?1,?2,?3,?3)")
            .unwrap();
        for index in 0..count {
            insert
                .execute(rusqlite::params![
                    uuid::Uuid::new_v4().to_string(),
                    format!("Task {index:05}"),
                    index as i64
                ])
                .unwrap();
        }
    }
    tx.commit().unwrap();
    let (worker, ready) = TodoWorker::start(paths).unwrap();
    let client = worker.client();
    cx.update(gpui_kit::init);
    let (handle, view) = cx.update(|cx| {
        bind_keys(cx);
        crate::app::open_test_workspace(paths_for(&root), client, ready, cx)
    });
    settle(cx, &view);
    (
        root,
        worker,
        database,
        handle.downcast::<Root>().unwrap(),
        view,
    )
}

fn paths_for(root: &tempfile::TempDir) -> AppPaths {
    AppPaths {
        data_dir: root.path().join("native"),
    }
}

fn settle(cx: &mut TestAppContext, page: &Entity<TodoPage>) {
    for _ in 0..1000 {
        cx.executor().advance_clock(Duration::from_millis(10));
        cx.run_until_parked();
        if cx.update(|cx| {
            let page = page.read(cx);
            !page.loading && !page.busy && !page.notes.read(cx).has_pending_images()
        }) {
            return;
        }
        std::thread::sleep(Duration::from_millis(2));
    }
    assert!(
        cx.update(|cx| {
            let page = page.read(cx);
            !page.loading && !page.busy && !page.notes.read(cx).has_pending_images()
        }),
        "The production worker did not settle in two seconds"
    );
}

fn focus_notes(window: &mut Window, cx: &mut gpui_kit::App, page: &Entity<TodoPage>) {
    let input = page.read(cx).notes.read(cx).input_id();
    if !window.find(input.clone()).visible() {
        window.scroll(
            "editor-fields",
            gpui_kit::ScrollDelta::Pixels(gpui_kit::point(px(0.), px(-1000.))),
            cx,
        );
    }
    window.click(input, cx);
}

#[gpui_kit::test]
fn marked_chinese_text_does_not_submit_or_discard_the_draft(cx: &mut TestAppContext) {
    let _guard = UI_TEST_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let (_root, worker, _database, handle, page) = open(cx, 0);
    cx.update_window(handle.into(), |_, window, cx| {
        window.render_frame(cx);
        window.click("todo-new", cx);
    })
    .unwrap();
    settle(cx, &page);
    cx.update_window(handle.into(), |_, window, cx| {
        window.render_frame(cx);
        window.click("task-title", cx);
        let title = page.read(cx).title.clone();
        let bounds = window.find("task-title").bounds();
        let mut input = TestInput::new(ElementInputHandler::new(bounds, title), window);
        input.compose_text(None, "中文", Some(2..2), cx);
        assert_eq!(input.marked_text_range(cx), Some(0..2));
    })
    .unwrap();
    settle(cx, &page);
    cx.update_window(handle.into(), |_, window, cx| window.press("enter", cx))
        .unwrap();
    settle(cx, &page);
    assert!(
        block_on(
            worker
                .client()
                .list(TodoView::Active, String::new())
                .unwrap()
        )
        .unwrap()
        .is_empty()
    );
    cx.update_window(handle.into(), |_, window, cx| window.press("escape", cx))
        .unwrap();
    settle(cx, &page);
    cx.update_window(handle.into(), |_, window, cx| {
        window.render_frame(cx);
        assert!(window.try_find("leave-discard").is_none());
        assert_eq!(window.find("task-title").value(), Some("中文"));
        window.press("enter", cx);
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
        (records.len(), records[0].item().title.as_str()),
        (1, "中文")
    );
    worker.shutdown().unwrap();
}

#[gpui_kit::test]
fn ten_thousand_tasks_are_virtualized_and_only_the_latest_search_is_applied(
    cx: &mut TestAppContext,
) {
    let _guard = UI_TEST_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let (_root, worker, _database, handle, page) = open(cx, 10_000);
    cx.update_window(handle.into(), |_, window, cx| {
        use gpui_kit::test::TestQueryExt;
        window.render_frame(cx);
        let visible_rows = window
            .elements()
            .into_iter()
            .filter(|item| {
                item.label()
                    .is_some_and(|label| label.starts_with("Task 0"))
            })
            .count();
        assert!(
            (1..100).contains(&visible_rows),
            "Rendered {visible_rows} rows for 10000 tasks"
        );
        let before: Vec<_> = window
            .elements()
            .into_iter()
            .filter_map(|item| {
                item.label()
                    .filter(|label| label.starts_with("Task 0"))
                    .map(str::to_owned)
            })
            .collect();
        let first_id = page.read(cx).rows.read(cx).delegate().records[0]
            .item()
            .id
            .clone();
        window.scroll(
            gpui_kit::SharedString::from(format!("todo-row:{first_id}")),
            gpui_kit::ScrollDelta::Pixels(gpui_kit::point(px(0.), px(-440.))),
            cx,
        );
        let after: Vec<_> = window
            .elements()
            .into_iter()
            .filter_map(|item| {
                item.label()
                    .filter(|label| label.starts_with("Task 0"))
                    .map(str::to_owned)
            })
            .collect();
        assert_ne!(before, after);
        window.click("todo-search", cx);
        window.input("Task 00001", cx);
        window.press("cmd-a", cx);
        window.input("Task 09999", cx);
    })
    .unwrap();
    cx.executor().advance_clock(Duration::from_millis(200));
    settle(cx, &page);
    cx.update(|cx| {
        let rows = page.read(cx).rows.read(cx);
        assert_eq!(rows.delegate().records.len(), 1);
        assert_eq!(rows.delegate().records[0].item().title, "Task 09999");
    });
    // Exercise the keyboard path and the empty-list focus target after completing the result.
    let id = cx.update(|cx| {
        page.read(cx).rows.read(cx).delegate().records[0]
            .item()
            .id
            .clone()
    });
    cx.update_window(handle.into(), |_, window, cx| {
        window.click(
            gpui_kit::SharedString::from(format!("todo-complete:{id}")),
            cx,
        );
    })
    .unwrap();
    settle(cx, &page);
    cx.update_window(handle.into(), |_, window, cx| {
        window.render_frame(cx);
        assert!(window.try_find("todo-editor").is_none());
        assert_eq!(window.find("todo-new").focused(), Some(true));
    })
    .unwrap();
    worker.shutdown().unwrap();
}

#[gpui_kit::test]
fn read_failure_retains_the_previous_projection_instead_of_showing_an_empty_list(
    cx: &mut TestAppContext,
) {
    let _guard = UI_TEST_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let (_root, worker, database, handle, page) = open(cx, 2);
    database
        .conn()
        .unwrap()
        .execute_batch("ALTER TABLE todo_items RENAME TO isolated_hidden_items")
        .unwrap();
    cx.update_window(handle.into(), |_, window, cx| {
        page.update(cx, |page, cx| page.reload(window, cx))
    })
    .unwrap();
    settle(cx, &page);
    cx.update_window(handle.into(), |_, window, cx| {
        window.render_frame(cx);
        assert!(window.find("todo-read-error").visible());
        assert!(window.try_find("todo-empty").is_none());
        assert_eq!(page.read(cx).rows.read(cx).delegate().records.len(), 2);
    })
    .unwrap();
    database
        .conn()
        .unwrap()
        .execute_batch("ALTER TABLE isolated_hidden_items RENAME TO todo_items")
        .unwrap();
    cx.update_window(handle.into(), |_, window, cx| {
        window.click("todo-retry", cx)
    })
    .unwrap();
    settle(cx, &page);
    cx.update_window(handle.into(), |_, window, _| {
        assert!(window.try_find("todo-read-error").is_none())
    })
    .unwrap();
    worker.shutdown().unwrap();
}

#[gpui_kit::test]
fn failed_close_preserves_the_window_and_retry_persists_the_latest_draft(cx: &mut TestAppContext) {
    let _guard = UI_TEST_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let (root, worker, database, handle, page) = open(cx, 0);
    cx.update_window(handle.into(), |_, window, cx| {
        window.click("todo-new", cx);
        window.click("task-title", cx);
        window.input("关闭时保存的草稿", cx);
    })
    .unwrap();
    settle(cx, &page);
    database.conn().unwrap().execute_batch("CREATE TRIGGER deny_state BEFORE UPDATE ON app_meta BEGIN SELECT RAISE(ABORT, 'isolated close failure'); END;").unwrap();
    assert!(!gpui_kit::VisualTestContext::from_window(handle.into(), cx).simulate_close());
    settle(cx, &page);
    cx.simulate_window_resize(handle.into(), gpui_kit::size(px(720.), px(480.)));
    cx.update_window(handle.into(), |_, window, cx| {
        page.update(cx, |page, cx| {
            page.set_preferences(
                Preferences::new(
                    crate::i18n::LanguagePreference::English,
                    crate::preferences::AppearancePreference::Light,
                ),
                window,
                cx,
            );
        });
        window.render_frame(cx);
        assert!(window.find("state-error").visible());
        assert_eq!(
            window.find("state-error").label(),
            Some(text("errors.persistence", Locale::English).as_ref())
        );
        let retry = window.find("state-retry").bounds();
        assert!(retry.right() <= px(720.) && retry.bottom() <= px(480.));
        assert_eq!(
            page.read(cx).search.read(cx).presentation().placeholder(),
            "Search tasks"
        );
        assert_eq!(
            page.read(cx).title.read(cx).presentation().placeholder(),
            "Task title"
        );
        assert_eq!(window.find("task-title").value(), Some("关闭时保存的草稿"));
        window.press("cmd-q", cx);
    })
    .unwrap();
    settle(cx, &page);
    assert!(!cx.read(|cx| cx.windows().is_empty()));
    database
        .conn()
        .unwrap()
        .execute_batch("DROP TRIGGER deny_state")
        .unwrap();
    assert!(!gpui_kit::VisualTestContext::from_window(handle.into(), cx).simulate_close());
    settle(cx, &page);
    assert!(cx.read(|cx| cx.windows().is_empty()));
    worker.shutdown().unwrap();
    let (reopened, ready) = TodoWorker::start(paths_for(&root)).unwrap();
    block_on(ready).unwrap();
    assert_eq!(
        block_on(reopened.client().load_session().unwrap())
            .unwrap()
            .draft
            .unwrap()
            .title,
        "关闭时保存的草稿"
    );
    reopened.shutdown().unwrap();
}

#[gpui_kit::test]
fn pending_write_blocks_duplicate_submission_navigation_and_window_close(cx: &mut TestAppContext) {
    let _guard = UI_TEST_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let (_root, worker, database, handle, page) = open(cx, 0);
    let lock = database.conn().unwrap();
    lock.execute_batch("BEGIN IMMEDIATE").unwrap();
    cx.update_window(handle.into(), |_, window, cx| {
        window.click("todo-new", cx);
        window.click("task-title", cx);
        window.input("Only one write", cx);
        window.click("editor-save", cx);
        window.click("editor-save", cx);
        assert_eq!(window.find("editor-save").disabled(), Some(true));
        assert_eq!(window.find("nav-settings").disabled(), Some(true));
        window.click("nav-settings", cx);
        assert_eq!(window.find("task-title").value(), Some("Only one write"));
    })
    .unwrap();
    assert!(!gpui_kit::VisualTestContext::from_window(handle.into(), cx).simulate_close());
    cx.update_window(handle.into(), |_, window, cx| window.press("cmd-q", cx))
        .unwrap();
    assert!(!cx.read(|cx| cx.windows().is_empty()));
    lock.execute_batch("ROLLBACK").unwrap();
    settle(cx, &page);
    assert_eq!(
        block_on(
            worker
                .client()
                .list(TodoView::Active, String::new())
                .unwrap()
        )
        .unwrap()
        .len(),
        1
    );
    cx.update_window(handle.into(), |_, window, cx| window.press("cmd-q", cx))
        .unwrap();
    settle(cx, &page);
    assert!(cx.read(|cx| cx.windows().is_empty()));
    worker.shutdown().unwrap();
}

#[gpui_kit::test]
fn revision_conflict_is_visible_and_keeps_the_editor_input(cx: &mut TestAppContext) {
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
        )
    })
    .unwrap();
    settle(cx, &page);
    cx.update_window(handle.into(), |_, window, cx| {
        if window.try_find("details-edit").is_some() {
            window.click("details-edit", cx);
        }
        window.click("task-title", cx);
        window.press("cmd-a", cx);
        window.input("My draft", cx);
    })
    .unwrap();
    let mut changed = Draft::edit(&record);
    changed.title = "Another writer".into();
    block_on(
        worker
            .client()
            .update(record.item().id.clone(), changed.input(), record.revision())
            .unwrap(),
    )
    .unwrap();
    cx.update_window(handle.into(), |_, window, cx| {
        window.click("editor-save", cx)
    })
    .unwrap();
    settle(cx, &page);
    cx.update_window(handle.into(), |_, window, cx| {
        window.render_frame(cx);
        assert!(window.find("editor-error").visible());
        assert_eq!(window.find("task-title").value(), Some("My draft"));
        assert_eq!(
            page.read(cx).write_error.as_ref().unwrap().code,
            "todo:note_conflict"
        );
    })
    .unwrap();
    assert_eq!(
        block_on(worker.client().get(record.item().id.clone()).unwrap())
            .unwrap()
            .item()
            .title,
        "Another writer"
    );
    worker.shutdown().unwrap();
}

#[gpui_kit::test]
fn keyboard_completion_selects_the_neighbor_and_enter_opens_it(cx: &mut TestAppContext) {
    let _guard = UI_TEST_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let (_root, worker, _database, handle, page) = open(cx, 2);
    let records = block_on(
        worker
            .client()
            .list(TodoView::Active, String::new())
            .unwrap(),
    )
    .unwrap();
    cx.update_window(handle.into(), |_, window, cx| {
        window.click(
            gpui_kit::SharedString::from(format!("todo-row:{}", records[0].item().id)),
            cx,
        )
    })
    .unwrap();
    settle(cx, &page);
    cx.update_window(handle.into(), |_, window, cx| {
        window.click("details-close", cx);
        window.press("space", cx);
    })
    .unwrap();
    settle(cx, &page);
    cx.update_window(handle.into(), |_, window, cx| {
        assert_eq!(
            page.read(cx)
                .rows
                .read(cx)
                .delegate()
                .selected_id
                .as_deref(),
            Some(records[1].item().id.as_str())
        );
        window.press("enter", cx);
    })
    .unwrap();
    settle(cx, &page);
    cx.update_window(handle.into(), |_, _window, cx| {
        assert_eq!(
            page.read(cx)
                .session
                .draft
                .as_ref()
                .map(|draft| draft.title.as_str()),
            Some(records[1].item().title.as_str())
        );
    })
    .unwrap();
    worker.shutdown().unwrap();
}
