use super::RichTextEditorState;
use crate::i18n::text;
use gpui_kit::{
    AppContext, Context, Window,
    component::{
        ActiveTheme, Disableable, WindowExt,
        button::{Button, ButtonVariants},
        input::{Input, InputState},
    },
    div,
    prelude::*,
};

pub(super) fn valid_url(value: &str) -> bool {
    url::Url::parse(value).is_ok_and(|url| {
        matches!(url.scheme(), "https" | "http" | "mailto")
            && url.username().is_empty()
            && url.password().is_none()
            && (url.scheme() == "mailto" || url.host_str().is_some())
    })
}

impl RichTextEditorState {
    pub(super) fn edit_link(
        &mut self,
        current: Option<String>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.readonly || self.editor.read(cx).is_composing() {
            return;
        }
        let locale = self.locale;
        let input = cx.new(|cx| InputState::new(window, cx));
        input.update(cx, |input, cx| {
            input.set_value(current.unwrap_or_default(), window, cx)
        });
        let editor = self.editor.clone();
        let captured = editor.read(cx).capture_selection();
        window.open_dialog(cx, move |dialog, _, cx| {
            let input_for_save = input.clone();
            let editor = editor.clone();
            let captured = captured.clone();
            let value = input.read(cx).value();
            let invalid = !value.trim().is_empty() && !valid_url(value.trim());
            dialog
                .title(text("rich_text.link", locale).into_owned())
                .child(
                    Input::new(&input)
                        .id("rich-text-url")
                        .aria_label(text("rich_text.url", locale).into_owned()),
                )
                .when(invalid, |dialog| {
                    dialog.child(
                        div()
                            .text_color(cx.theme().danger)
                            .child(text("rich_text.url_invalid", locale).into_owned()),
                    )
                })
                .footer({
                    let input = input_for_save.clone();
                    let editor = editor.clone();
                    let captured = captured.clone();
                    div()
                        .flex()
                        .justify_end()
                        .gap_2()
                        .child(
                            Button::new("rich-text-link-cancel")
                                .label(text("todo.cancel", locale).into_owned())
                                .on_click(|_, window, cx| window.close_dialog(cx)),
                        )
                        .child(
                            Button::new("rich-text-link-save")
                                .primary()
                                .disabled(invalid)
                                .label(text("todo.save", locale).into_owned())
                                .on_click(move |_, window, cx| {
                                    let value = input.read(cx).value().trim().to_owned();
                                    if !value.is_empty() && !valid_url(&value) {
                                        return;
                                    }
                                    if captured.as_ref().is_ok_and(|range| {
                                        editor.read(cx).is_capture_current(range)
                                    }) {
                                        editor.update(cx, |editor, cx| {
                                            editor.set_link(
                                                (!value.is_empty()).then_some(value.as_str()),
                                                cx,
                                            );
                                        });
                                    }
                                    window.close_dialog(cx);
                                    editor.update(cx, |editor, cx| editor.focus(window, cx));
                                }),
                        )
                })
        });
    }
}
