use super::*;
use gpui_kit::{ClipboardItem, Image, ImageFormat};
use std::io::Cursor;

fn png() -> Vec<u8> {
    let image = image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
        16,
        8,
        image::Rgba([30, 80, 140, 255]),
    ));
    let mut bytes = Cursor::new(Vec::new());
    image.write_to(&mut bytes, image::ImageFormat::Png).unwrap();
    bytes.into_inner()
}

fn begin(cx: &mut gpui_kit::App, window: &mut Window, page: &Entity<TodoPage>, bytes: Vec<u8>) {
    window.click("todo-new", cx);
    window.click("task-title", cx);
    window.input("粘贴图片", cx);
    focus_notes(window, cx, page);
    window.input("前文", cx);
    cx.write_to_clipboard(ClipboardItem::new_image(&Image::from_bytes(
        ImageFormat::Png,
        bytes,
    )));
    window.press("cmd-v", cx);
    window.render_frame(cx);
}

#[gpui_kit::test]
fn pasted_image_is_optimistic_typing_continues_and_save_reopens_owned_asset(
    cx: &mut TestAppContext,
) {
    let _guard = UI_TEST_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let (_root, worker, database, handle, page) = open(cx, 0);
    let mut asset = String::new();
    cx.update_window(handle.into(), |_, window, cx| {
        begin(cx, window, &page, png());
    })
    .unwrap();
    cx.update_window(handle.into(), |_, window, cx| {
        asset = page
            .read(cx)
            .notes
            .read(cx)
            .snapshot(cx)
            .image_ids()
            .unwrap()
            .remove(0);
        assert!(page.read(cx).notes.read(cx).has_pending_images());
        window.input("后文🧩", cx);
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
    assert_eq!(records[0].item().notes.as_deref(), Some("前文后文🧩"));
    let item = &records[0].item().id;
    let ownership: (String, Option<String>, i64) = database
        .conn()
        .unwrap()
        .query_row(
            "SELECT item_id,draft_id,LENGTH(data) FROM native_note_images WHERE id=?1",
            [&asset],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(ownership.0, *item);
    assert_eq!(ownership.1, None);
    assert_eq!(ownership.2, png().len() as i64);
    cx.update_window(handle.into(), |_, window, cx| {
        window.click(gpui_kit::SharedString::from(format!("todo-row:{item}")), cx)
    })
    .unwrap();
    settle(cx, &page);
    cx.update_window(handle.into(), |_, window, cx| {
        window.render_frame(cx);
        assert_eq!(
            page.read(cx)
                .notes
                .read(cx)
                .snapshot(cx)
                .image_ids()
                .unwrap(),
            vec![asset]
        );
        assert!(!page.read(cx).notes.read(cx).has_failed_images(cx));
    })
    .unwrap();
    worker.shutdown().unwrap();
}

#[gpui_kit::test]
fn failed_paste_keeps_text_blocks_save_and_can_be_removed(cx: &mut TestAppContext) {
    let _guard = UI_TEST_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let (_root, worker, database, handle, page) = open(cx, 0);
    let mut asset = String::new();
    cx.update_window(handle.into(), |_, window, cx| {
        begin(cx, window, &page, b"corrupt image".to_vec());
    })
    .unwrap();
    cx.update_window(handle.into(), |_, _, cx| {
        asset = page
            .read(cx)
            .notes
            .read(cx)
            .snapshot(cx)
            .image_ids()
            .unwrap()
            .remove(0);
    })
    .unwrap();
    settle(cx, &page);
    cx.update_window(handle.into(), |_, window, cx| {
        assert!(page.read(cx).notes.read(cx).has_failed_images(cx));
        window.click("editor-save", cx);
        assert_eq!(
            page.read(cx).write_error.as_ref().unwrap().code,
            "native:image_missing"
        );
        assert_eq!(page.read(cx).notes.read(cx).value(cx), "前文");
        window.scroll(
            "editor-fields",
            gpui_kit::ScrollDelta::Pixels(gpui_kit::point(px(0.), px(-1000.))),
            cx,
        );
        window.click(
            gpui_kit::SharedString::from(format!("rich-text-image-remove:{asset}")),
            cx,
        );
        window.click("editor-save", cx);
    })
    .unwrap();
    settle(cx, &page);
    assert_eq!(
        database
            .conn()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM native_note_images", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_eq!(
        block_on(
            worker
                .client()
                .list(TodoView::Active, String::new())
                .unwrap()
        )
        .unwrap()[0]
            .item()
            .notes
            .as_deref(),
        Some("前文")
    );
    worker.shutdown().unwrap();
}

#[gpui_kit::test]
fn close_waits_for_image_worker_and_restores_draft_without_replay(cx: &mut TestAppContext) {
    let _guard = UI_TEST_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let (root, worker, _database, handle, page) = open(cx, 0);
    cx.update_window(handle.into(), |_, window, cx| {
        begin(cx, window, &page, png());
    })
    .unwrap();
    assert!(!gpui_kit::VisualTestContext::from_window(handle.into(), cx).simulate_close());
    settle(cx, &page);
    worker.shutdown().unwrap();
    let (reopened, ready) = TodoWorker::start(paths_for(&root)).unwrap();
    block_on(ready).unwrap();
    let draft = block_on(reopened.client().load_session().unwrap())
        .unwrap()
        .draft
        .unwrap();
    let images = block_on(reopened.client().load_images(draft).unwrap()).unwrap();
    assert_eq!(images.len(), 1);
    assert!(images[0].1.is_some());
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

#[gpui_kit::test]
fn context_menu_copies_original_image_and_pasting_allocates_a_new_owned_resource(
    cx: &mut TestAppContext,
) {
    use gpui_kit::{
        MouseButton, SharedString,
        test::{TestEventExt, TestQueryExt},
    };
    let _guard = UI_TEST_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let (_root, worker, _database, handle, page) = open(cx, 0);
    cx.update_window(handle.into(), |_, window, cx| {
        begin(cx, window, &page, png());
    })
    .unwrap();
    cx.update_window(handle.into(), |_, window, cx| {
        window.click("editor-save", cx)
    })
    .unwrap();
    settle(cx, &page);
    let source = block_on(worker.client().list(TodoView::Active, "".into()).unwrap())
        .unwrap()
        .remove(0);
    let original = block_on(
        worker
            .client()
            .load_document(source.item().id.clone())
            .unwrap(),
    )
    .unwrap()
    .1
    .image_ids()
    .unwrap()
    .remove(0);
    cx.update_window(handle.into(), |_, window, cx| {
        window.render_frame(cx);
        assert!(
            window
                .find(SharedString::from(format!(
                    "todo-thumbnail:{}",
                    source.item().id
                )))
                .visible()
        );
        assert!(
            page.read(cx).rows.read(cx).delegate().summaries[&source.item().id].image_count == 1
        );
        window.click(
            SharedString::from(format!("todo-row:{}", source.item().id)),
            cx,
        );
    })
    .unwrap();
    settle(cx, &page);
    cx.update_window(handle.into(), |_, window, cx| {
        window.right_click("rich-text-reader", cx);
    })
    .unwrap();
    cx.update_window(handle.into(), |_, window, cx| {
        window.render_frame(cx);
        let point = window
            .find_by_label(&text("rich_text.copy_image", page.read(cx).locale()))
            .bounds()
            .center();
        window.pointer_down(point, MouseButton::Left, cx);
        window.pointer_up(point, MouseButton::Left, cx);
    })
    .unwrap();
    // Clipboard reads below use TestPlatform's in-memory clipboard.
    for _ in 0..100 {
        cx.run_until_parked();
        if cx.update(|cx| {
            cx.read_from_clipboard().is_some_and(|item| {
                item.entries()
                    .iter()
                    .any(|entry| matches!(entry, gpui_kit::ClipboardEntry::Image(_)))
            })
        }) {
            break;
        }
        std::thread::sleep(Duration::from_millis(2));
    }
    cx.update_window(handle.into(), |_, window, cx| {
        let clipboard = cx.read_from_clipboard().unwrap();
        let bytes = clipboard
            .entries()
            .iter()
            .find_map(|entry| match entry {
                gpui_kit::ClipboardEntry::Image(image) => Some(image.bytes.as_slice()),
                _ => None,
            })
            .unwrap();
        assert_eq!(bytes, png());
        window.click("details-close", cx);
        window.click("todo-new", cx);
        window.click("task-title", cx);
        window.input("原图副本", cx);
        focus_notes(window, cx, &page);
        window.press("cmd-v", cx);
    })
    .unwrap();
    cx.update_window(handle.into(), |_, window, cx| {
        window.click("editor-save", cx)
    })
    .unwrap();
    settle(cx, &page);
    let records = block_on(worker.client().list(TodoView::Active, "".into()).unwrap()).unwrap();
    assert_eq!(records.len(), 2);
    let copied = records
        .iter()
        .find(|record| record.item().title == "原图副本")
        .unwrap();
    let copied_id = block_on(
        worker
            .client()
            .load_document(copied.item().id.clone())
            .unwrap(),
    )
    .unwrap()
    .1
    .image_ids()
    .unwrap()
    .remove(0);
    assert_ne!(original, copied_id);
    worker.shutdown().unwrap();
}

#[gpui_kit::test]
fn formatted_image_paste_rejects_stale_selection_then_preserves_text_and_images(
    cx: &mut TestAppContext,
) {
    use gpui_kit::SharedString;
    let _guard = UI_TEST_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let (_root, worker, database, handle, page) = open(cx, 0);
    cx.update_window(handle.into(), |_, window, cx| {
        begin(cx, window, &page, png());
    })
    .unwrap();
    cx.update_window(handle.into(), |_, window, cx| {
        window.click("editor-save", cx)
    })
    .unwrap();
    settle(cx, &page);
    let source = block_on(worker.client().list(TodoView::Active, "".into()).unwrap())
        .unwrap()
        .remove(0);
    let original = block_on(
        worker
            .client()
            .load_document(source.item().id.clone())
            .unwrap(),
    )
    .unwrap()
    .1
    .image_ids()
    .unwrap()
    .remove(0);
    cx.update_window(handle.into(), |_, window, cx| {
        window.click(
            SharedString::from(format!("todo-row:{}", source.item().id)),
            cx,
        );
    })
    .unwrap();
    settle(cx, &page);
    cx.update_window(handle.into(), |_, window, cx| {
        window.click("details-edit", cx);
        focus_notes(window, cx, &page);
        window.press("cmd-a", cx);
        window.press("cmd-c", cx);
        window.click("editor-cancel", cx);
        window.click("todo-new", cx);
        window.click("task-title", cx);
        window.input("图文副本", cx);
        focus_notes(window, cx, &page);
    })
    .unwrap();
    let lock = database.conn().unwrap();
    lock.execute_batch("BEGIN IMMEDIATE").unwrap();
    cx.update_window(handle.into(), |_, window, cx| {
        window.press("cmd-v", cx);
    })
    .unwrap();
    cx.update_window(handle.into(), |_, window, cx| {
        assert!(page.read(cx).notes.read(cx).has_pending_images());
        window.input("继续输入", cx);
    })
    .unwrap();
    lock.execute_batch("ROLLBACK").unwrap();
    settle(cx, &page);
    cx.update_window(handle.into(), |_, window, cx| {
        assert_eq!(page.read(cx).notes.read(cx).value(cx), "继续输入");
        assert!(
            page.read(cx)
                .notes
                .read(cx)
                .snapshot(cx)
                .image_ids()
                .unwrap()
                .is_empty()
        );
        window.press("cmd-v", cx);
    })
    .unwrap();
    cx.update_window(handle.into(), |_, window, cx| {
        window.click("editor-save", cx)
    })
    .unwrap();
    settle(cx, &page);
    let records = block_on(worker.client().list(TodoView::Active, "".into()).unwrap()).unwrap();
    assert_eq!(records.len(), 2);
    let copied = records
        .iter()
        .find(|record| record.item().title == "图文副本")
        .unwrap();
    let document = block_on(
        worker
            .client()
            .load_document(copied.item().id.clone())
            .unwrap(),
    )
    .unwrap()
    .1;
    assert!(document.plain_text().unwrap().contains("前文"));
    assert!(document.plain_text().unwrap().contains("继续输入"));
    assert_eq!(document.image_ids().unwrap().len(), 1);
    assert_ne!(document.image_ids().unwrap()[0], original);
    assert_eq!(
        database
            .conn()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM native_note_images", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        2
    );
    worker.shutdown().unwrap();
}
