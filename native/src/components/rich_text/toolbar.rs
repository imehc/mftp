use super::RichTextEditorState;
use crate::i18n::text;
use gpui_kit::{
    Context, IntoElement, TestSupportExt,
    assets::IconName,
    component::{
        ActiveTheme, Disableable, Sizable,
        button::{Button, ButtonVariants, Toggle, ToggleVariants},
        toolbar::Toolbar,
    },
    div,
    prelude::*,
};
use markdown_editor::{BlockKind, EditorCommand, MarkKind, MarkState};

impl RichTextEditorState {
    pub(super) fn render_toolbar(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let locale = self.locale;
        let model = self.editor.read(cx).model();
        let can_undo = model.can_undo();
        let can_redo = model.can_redo();
        let marks_disabled = model
            .block_kind_at_caret()
            .is_none_or(|kind| kind == BlockKind::CodeBlock);
        let mark = |id, key, icon, kind| {
            let editor = self.editor.clone();
            Toggle::new(id)
                .disabled(marks_disabled)
                .ghost()
                .small()
                .icon(icon)
                .checked(model.mark_state(kind) == MarkState::On)
                .tooltip(text(key, locale).into_owned())
                .on_click(move |_, window, cx| {
                    editor.update(cx, |editor, cx| {
                        let _ = editor.run(EditorCommand::ToggleMark(kind), cx);
                        editor.focus(window, cx);
                    });
                })
        };
        let undo_editor = self.editor.clone();
        let redo_editor = self.editor.clone();
        let count = rust_i18n::t!(
            "rich_text.character_count",
            locale = locale.as_str(),
            count = self.character_count()
        )
        .into_owned();
        Toolbar::new("rich-text-toolbar")
            .min_w_0()
            .w_full()
            .child(mark(
                "rich-text-bold",
                "rich_text.bold",
                IconName::Bold,
                MarkKind::Bold,
            ))
            .child(mark(
                "rich-text-italic",
                "rich_text.italic",
                IconName::Italic,
                MarkKind::Italic,
            ))
            .when(self.expanded_toolbar, |toolbar| {
                toolbar
                    .child(
                        Button::new("rich-text-link")
                            .ghost()
                            .small()
                            .icon(IconName::Link)
                            .tooltip(text("rich_text.link", locale).into_owned())
                            .disabled(marks_disabled)
                            .on_click(
                                cx.listener(|this, _, window, cx| this.edit_link(None, window, cx)),
                            ),
                    )
                    .child(self.command_button(
                        "rich-text-bullets",
                        "rich_text.bullets",
                        IconName::List,
                        EditorCommand::ToggleList { ordered: false },
                    ))
                    .child(self.command_button(
                        "rich-text-numbered",
                        "rich_text.numbered",
                        IconName::ListOrdered,
                        EditorCommand::ToggleList { ordered: true },
                    ))
            })
            .child(
                Button::new("rich-text-image")
                    .ghost()
                    .small()
                    .icon(IconName::Image)
                    .tooltip(text("rich_text.image", locale).into_owned())
                    .disabled(self.has_pending_images())
                    .on_click(cx.listener(|this, _, window, cx| this.choose_image(window, cx))),
            )
            .content(self.render_format_menu(cx))
            .when(self.expanded_toolbar, |toolbar| {
                toolbar
                    .child(
                        Button::new("rich-text-undo")
                            .ghost()
                            .small()
                            .icon(IconName::Undo)
                            .tooltip(text("rich_text.undo", locale).into_owned())
                            .disabled(!can_undo)
                            .on_click(move |_, window, cx| {
                                undo_editor.update(cx, |editor, cx| {
                                    editor.undo(cx);
                                    editor.focus(window, cx);
                                });
                            }),
                    )
                    .child(
                        Button::new("rich-text-redo")
                            .ghost()
                            .small()
                            .icon(IconName::Redo)
                            .tooltip(text("rich_text.redo", locale).into_owned())
                            .disabled(!can_redo)
                            .on_click(move |_, window, cx| {
                                redo_editor.update(cx, |editor, cx| {
                                    editor.redo(cx);
                                    editor.focus(window, cx);
                                });
                            }),
                    )
            })
            .content(div().flex_1().min_w_0())
            .content(
                div()
                    .id("rich-text-count")
                    .test_support()
                    .aria_label(count.clone())
                    .text_xs()
                    .text_color(cx.theme().muted_foreground)
                    .flex_shrink_0()
                    .px_2()
                    .child(count),
            )
    }

    fn command_button(
        &self,
        id: &'static str,
        key: &'static str,
        icon: IconName,
        command: EditorCommand,
    ) -> Button {
        let editor = self.editor.clone();
        Button::new(id)
            .ghost()
            .small()
            .icon(icon)
            .tooltip(text(key, self.locale).into_owned())
            .on_click(move |_, window, cx| {
                editor.update(cx, |editor, cx| {
                    let _ = editor.run(command.clone(), cx);
                    editor.focus(window, cx);
                });
            })
    }
}
