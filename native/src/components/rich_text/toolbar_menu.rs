use super::RichTextEditorState;
use crate::i18n::text;
use gpui_kit::{
    Context, IntoElement,
    assets::IconName,
    component::{
        Sizable,
        button::{Button, ButtonVariants},
        menu::{DropdownMenu, PopupMenuItem},
    },
};
use markdown_editor::{BlockKind, EditorCommand, MarkKind};

impl RichTextEditorState {
    pub(super) fn render_format_menu(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let locale = self.locale;
        let expanded = self.expanded_toolbar;
        let editor = self.editor.clone();
        let owner = cx.weak_entity();
        Button::new("rich-text-format")
            .ghost()
            .small()
            .icon(IconName::Ellipsis)
            .tooltip(text("rich_text.format", locale).into_owned())
            .dropdown_menu(move |mut menu, _, cx| {
                for (key, command) in [
                    (
                        "rich_text.paragraph",
                        EditorCommand::SetBlockKind(BlockKind::Paragraph),
                    ),
                    (
                        "rich_text.heading",
                        EditorCommand::SetBlockKind(BlockKind::Heading { level: 2 }),
                    ),
                    ("rich_text.quote", EditorCommand::ToggleBlockquote),
                    (
                        "rich_text.code_block",
                        EditorCommand::SetCodeBlock { lang: None },
                    ),
                    (
                        "rich_text.strike",
                        EditorCommand::ToggleMark(MarkKind::Strikethrough),
                    ),
                    (
                        "rich_text.inline_code",
                        EditorCommand::ToggleMark(MarkKind::Code),
                    ),
                ]
                .into_iter()
                .chain(
                    (!expanded)
                        .then_some([
                            (
                                "rich_text.bullets",
                                EditorCommand::ToggleList { ordered: false },
                            ),
                            (
                                "rich_text.numbered",
                                EditorCommand::ToggleList { ordered: true },
                            ),
                        ])
                        .into_iter()
                        .flatten(),
                ) {
                    let editor = editor.clone();
                    menu = menu.item(PopupMenuItem::new(text(key, locale).into_owned()).on_click(
                        move |_, window, cx| {
                            editor.update(cx, |editor, cx| {
                                let _ = editor.run(command.clone(), cx);
                                editor.focus(window, cx);
                            });
                        },
                    ));
                }
                if !expanded {
                    let owner = owner.clone();
                    menu = menu.separator().item(
                        PopupMenuItem::new(text("rich_text.link", locale).into_owned()).on_click(
                            move |_, window, cx| {
                                let _ =
                                    owner.update(cx, |owner, cx| owner.edit_link(None, window, cx));
                            },
                        ),
                    );
                    for (key, undo, enabled) in [
                        ("rich_text.undo", true, editor.read(cx).model().can_undo()),
                        ("rich_text.redo", false, editor.read(cx).model().can_redo()),
                    ] {
                        let editor = editor.clone();
                        menu = menu.item(
                            PopupMenuItem::new(text(key, locale).into_owned())
                                .disabled(!enabled)
                                .on_click(move |_, window, cx| {
                                    editor.update(cx, |editor, cx| {
                                        if undo {
                                            editor.undo(cx);
                                        } else {
                                            editor.redo(cx);
                                        }
                                        editor.focus(window, cx);
                                    });
                                }),
                        );
                    }
                }
                menu
            })
    }
}
