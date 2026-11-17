#![expect(
    clippy::unwrap_used,
    reason = "Rich text tests use isolated windows and literal fixtures."
)]

use super::*;
use crate::UI_TEST_LOCK;
use gpui_kit::{
    ElementInputHandler, Focusable, TestAppContext,
    test::{TestInput, TestWindowExt},
};
mod images;
mod toolbar;

#[test]
fn literal_import_preserves_punctuation_unicode_and_hard_breaks() {
    for text in [
        "# 标题不是格式",
        "**literal** [link](https://example.test)",
        "第一行\n第二行",
        "  缩进\t🧩 José",
        "甲\n\n乙",
        "末尾\n",
    ] {
        let document = RichTextDocument::from_plain_text(text);
        assert_eq!(document.plain_text().unwrap(), text, "{text:?}");
    }
}

#[test]
fn limits_and_unknown_versions_are_structured_errors() {
    let document = RichTextDocument::from_markdown("x".repeat(MAX_DOCUMENT_BYTES + 1));
    assert_eq!(
        document.validate().unwrap_err().code,
        "native:rich_text_invalid"
    );
    let document: RichTextDocument =
        serde_json::from_str(r#"{"version":99,"format":"markdown","source":"保留内容"}"#).unwrap();
    assert!(document.validate().is_err());
    let document = RichTextDocument::from_markdown("a\n\n".repeat(2001));
    assert!(document.validate().is_err());
}

fn open(cx: &mut TestAppContext) -> (gpui_kit::AnyWindowHandle, Entity<RichTextEditorState>) {
    open_at_width(cx, 800.)
}

fn open_at_width(
    cx: &mut TestAppContext,
    width: f32,
) -> (gpui_kit::AnyWindowHandle, Entity<RichTextEditorState>) {
    cx.update(|cx| {
        gpui_kit::init(cx);
        super::init(cx);
    });
    cx.update(|cx| {
        let mut editor = None;
        let options = gpui_kit::WindowOptions {
            window_bounds: Some(gpui_kit::WindowBounds::Windowed(gpui_kit::Bounds::new(
                Default::default(),
                gpui_kit::size(gpui_kit::px(width), gpui_kit::px(600.)),
            ))),
            ..Default::default()
        };
        let (handle, _) = gpui_kit::open_window(options, cx, |window, cx| {
            let state = cx.new(|cx| {
                let mut state = RichTextEditorState::new(window, cx);
                state.set_presentation(Locale::Chinese, "备注".into(), false, cx);
                state
            });
            editor = Some(state.clone());
            state
        })
        .unwrap();
        (handle, editor.unwrap())
    })
}

#[gpui_kit::test]
fn formatting_focus_undo_and_immediate_snapshot_use_the_live_editor(cx: &mut TestAppContext) {
    let _guard = UI_TEST_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let (handle, editor) = open(cx);
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.click(editor.read(cx).input_id(), cx);
        window.input("中文🧩", cx);
        // Read before the subscription queue is flushed.
        assert_eq!(editor.read(cx).snapshot(cx).plain_text().unwrap(), "中文🧩");
        window.press("cmd-a", cx);
        window.click("rich-text-bold", cx);
        assert!(editor.read(cx).snapshot(cx).source().contains("**"));
        assert!(
            editor
                .read(cx)
                .editor
                .read(cx)
                .focus_handle(cx)
                .is_focused(window)
        );
        window.press("cmd-z", cx);
        assert!(!editor.read(cx).snapshot(cx).source().contains("**"));
        window.press("cmd-shift-z", cx);
        assert!(editor.read(cx).snapshot(cx).source().contains("**"));
    })
    .unwrap();
}

#[gpui_kit::test]
fn composing_enter_and_escape_do_not_submit_or_leave_the_editor(cx: &mut TestAppContext) {
    let _guard = UI_TEST_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let (handle, editor) = open(cx);
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        let state = editor.read(cx).editor.clone();
        let bounds = window.find(editor.read(cx).input_id()).bounds();
        state.update(cx, |state, cx| state.focus(window, cx));
        let mut input = TestInput::new(ElementInputHandler::new(bounds, state), window);
        input.compose_text(None, "中文", Some(2..2), cx);
        assert!(editor.read(cx).is_composing(cx));
        window.press("enter", cx);
        assert_eq!(editor.read(cx).value(cx), "中文");
        window.press("escape", cx);
        assert!(!editor.read(cx).is_composing(cx));
        assert_eq!(editor.read(cx).value(cx), "中文");
    })
    .unwrap();
}

#[test]
fn links_accept_supported_schemes_without_embedded_credentials() {
    for value in [
        "https://example.test/path",
        "http://example.test",
        "mailto:a@example.test",
    ] {
        assert!(links::valid_url(value));
    }
    for value in [
        "javascript:alert(1)",
        "file:///etc/passwd",
        "https://user:password@example.test",
        "https://",
    ] {
        assert!(!links::valid_url(value));
    }
}

#[gpui_kit::test]
fn link_dialog_inserts_visible_url_and_edits_existing_link_without_duplication(
    cx: &mut TestAppContext,
) {
    let _guard = UI_TEST_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let (handle, editor) = open(cx);
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.click(editor.read(cx).input_id(), cx);
        editor.update(cx, |state, cx| state.edit_link(None, window, cx));
        window.render_frame(cx);
        window.click("rich-text-url", cx);
        window.input("https://example.test", cx);
        window.render_frame(cx);
        window.click("rich-text-link-save", cx);
        assert_eq!(editor.read(cx).value(cx), "https://example.test");
        assert!(
            editor
                .read(cx)
                .snapshot(cx)
                .source()
                .contains("<https://example.test>")
        );
        window.press("cmd-z", cx);
        assert_eq!(editor.read(cx).value(cx), "");
        window.press("cmd-shift-z", cx);
        window.press("left", cx);
        editor.update(cx, |state, cx| {
            state.edit_link(Some("https://example.test".into()), window, cx)
        });
        window.render_frame(cx);
        window.click("rich-text-url", cx);
        window.press("cmd-a", cx);
        window.input("https://changed.test", cx);
        window.render_frame(cx);
        window.click("rich-text-link-save", cx);
        assert_eq!(editor.read(cx).value(cx), "https://example.test");
        assert!(
            editor
                .read(cx)
                .snapshot(cx)
                .source()
                .contains("](https://changed.test)")
        );
    })
    .unwrap();
}
