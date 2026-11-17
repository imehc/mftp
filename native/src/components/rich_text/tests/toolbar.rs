use super::*;
use gpui_kit::{px, test::TestQueryExt};

#[gpui_kit::test]
fn count_tracks_visible_graphemes_images_formatting_and_undo(cx: &mut TestAppContext) {
    let _guard = UI_TEST_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let (handle, editor) = open(cx);
    cx.update_window(handle, |_, window, cx| {
        let uri = format!("mftp-image:{}", uuid::Uuid::new_v4());
        let document = RichTextDocument::from_markdown(format!(
            "**中文** e\u{301} 👨‍👩‍👧‍👦\n\n[abc](https://example.test) ![替代文字]({uri})"
        ));
        editor
            .update(cx, |state, cx| state.set_document(document, cx))
            .unwrap();
        assert_eq!(editor.read(cx).character_count(), 7);
        window.render_frame(cx);
        assert_eq!(window.find("rich-text-count").label(), Some("7 字"));
        window.click(editor.read(cx).input_id(), cx);
        window.press("cmd-a", cx);
        window.input("🧩", cx);
    })
    .unwrap();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert_eq!(editor.read(cx).character_count(), 1);
        window.press("cmd-a", cx);
        window.click("rich-text-bold", cx);
    })
    .unwrap();
    cx.update_window(handle, |_, window, cx| {
        assert_eq!(editor.read(cx).character_count(), 1);
        assert!(editor.read(cx).snapshot(cx).source().contains("**"));
        window.press("cmd-z", cx);
        window.press("cmd-z", cx);
    })
    .unwrap();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert_eq!(editor.read(cx).character_count(), 7);
        assert_eq!(window.find("rich-text-count").label(), Some("7 字"));
        editor.update(cx, |state, cx| {
            state.set_presentation(Locale::English, "Notes".into(), false, cx)
        });
        window.render_frame(cx);
        assert_eq!(window.find("rich-text-count").label(), Some("7 chars"));
    })
    .unwrap();
}

#[gpui_kit::test]
fn toolbar_expands_for_available_editor_width_and_collapses_into_reachable_menu(
    cx: &mut TestAppContext,
) {
    let _guard = UI_TEST_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    for width in [800., 272.] {
        let (handle, editor) = open_at_width(cx, width);
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            window.render_frame(cx);
            let wide = width == 800.;
            assert_eq!(editor.read(cx).expanded_toolbar, wide);
            for id in [
                "rich-text-link",
                "rich-text-bullets",
                "rich-text-numbered",
                "rich-text-undo",
                "rich-text-redo",
            ] {
                assert_eq!(window.try_find(id).is_some(), wide, "{id}: {width}");
            }
            let surface = window.find("rich-text-surface").bounds();
            let image = window.find("rich-text-image").bounds();
            let more = window.find("rich-text-format").bounds();
            let count = window.find("rich-text-count").bounds();
            assert!(image.right() <= more.left());
            assert!(count.right() <= surface.right());
            assert!(more.right() <= count.left());
            assert!(surface.right() <= px(width));
            if !wide {
                window.click(editor.read(cx).input_id(), cx);
                window.input("列表内容", cx);
                window.click("rich-text-format", cx);
                let item = window.find_by_label("无序列表");
                assert!(item.visible());
                window.click(item.path().last().unwrap().clone(), cx);
                assert!(editor.read(cx).snapshot(cx).source().starts_with("- "));
            }
        })
        .unwrap();
    }
}
