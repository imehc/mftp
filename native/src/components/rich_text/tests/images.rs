use super::*;
use gpui_kit::{ClipboardItem, Image, ImageFormat};

#[test]
fn documents_only_accept_owned_image_ids_with_bounded_count() {
    for uri in [
        "https://example.test/a.png",
        "file:///private/image.png",
        "data:image/png;base64,abc",
        "mftp-image:invalid",
    ] {
        assert!(
            RichTextDocument::from_markdown(format!("![图]({uri})"))
                .validate()
                .is_err()
        );
    }
    let id = uuid::Uuid::new_v4();
    let source = format!("![图](mftp-image:{id})");
    assert_eq!(
        RichTextDocument::from_markdown(source.clone())
            .image_ids()
            .unwrap(),
        vec![id.to_string()]
    );
    assert!(
        RichTextDocument::from_markdown(format!("{source}\n\n").repeat(11))
            .validate()
            .is_err()
    );
}

#[gpui_kit::test]
fn deleting_a_pending_atom_cancels_work_and_late_results_do_not_restore_it(
    cx: &mut TestAppContext,
) {
    let _guard = UI_TEST_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let (handle, editor) = open(cx);
    cx.update_window(handle, |_, window, cx| {
        window.click(editor.read(cx).input_id(), cx);
        cx.write_to_clipboard(ClipboardItem::new_image(&Image::from_bytes(
            ImageFormat::Png,
            b"pending".to_vec(),
        )));
        window.press("cmd-v", cx);
    })
    .unwrap();
    cx.update_window(handle, |_, window, cx| {
        let epoch = editor.read(cx).image_epoch();
        let id = editor.read(cx).snapshot(cx).image_ids().unwrap().remove(0);
        let cancelled = editor.read(cx).image_cancellation(&id).unwrap();
        window.press("cmd-z", cx);
        // Change effects run after this input boundary.
        editor.update(cx, |state, cx| state.reconcile_images(cx));
        assert!(cancelled.load(std::sync::atomic::Ordering::Acquire));
        editor.update(cx, |state, cx| {
            state.resolve_image(
                epoch,
                &id,
                Err(crate::resources::images::error("cancelled")),
                window,
                cx,
            )
        });
        assert!(editor.read(cx).snapshot(cx).image_ids().unwrap().is_empty());
        assert!(!editor.read(cx).has_failed_images(cx));
        window.press("cmd-shift-z", cx);
        assert_eq!(editor.read(cx).snapshot(cx).image_ids().unwrap(), vec![id]);
        assert!(editor.read(cx).has_failed_images(cx));
    })
    .unwrap();
}

#[gpui_kit::test]
fn replacing_document_rejects_old_resource_results(cx: &mut TestAppContext) {
    let _guard = UI_TEST_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let (handle, editor) = open(cx);
    cx.update_window(handle, |_, window, cx| {
        window.click(editor.read(cx).input_id(), cx);
        cx.write_to_clipboard(ClipboardItem::new_image(&Image::from_bytes(
            ImageFormat::Png,
            b"pending".to_vec(),
        )));
        window.press("cmd-v", cx);
    })
    .unwrap();
    cx.update_window(handle, |_, window, cx| {
        let epoch = editor.read(cx).image_epoch();
        let id = editor.read(cx).snapshot(cx).image_ids().unwrap().remove(0);
        editor.update(cx, |state, cx| {
            state
                .set_document(RichTextDocument::from_plain_text("新文档"), cx)
                .unwrap();
            state.resolve_image(
                epoch,
                &id,
                Ok(std::sync::Arc::new(Image::empty())),
                window,
                cx,
            );
        });
        assert_eq!(editor.read(cx).value(cx), "新文档");
        assert!(!editor.read(cx).has_pending_images());
        assert_eq!(editor.read(cx).retained_image_count(), 0);
    })
    .unwrap();
}
