//! Todo form regions keep field validation beside its retained input.

use super::{Destination, TodoPage, render::message};
use crate::i18n::text;
use gpui_kit::{
    Context, FontWeight, IntoElement, Role, TestSupportExt,
    component::{
        ActiveTheme, Disableable, IconName, Sizable,
        button::{Button, ButtonVariants},
        input::Input,
    },
    div,
    prelude::*,
};

impl TodoPage {
    fn render_title_field(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let locale = self.locale();
        let error = self
            .write_error
            .as_ref()
            .filter(|error| error.code == "todo:title_required");
        div()
            .id("task-title-field")
            .test_support()
            .flex()
            .flex_col()
            .gap_2()
            .flex_shrink_0()
            .child(text("todo.title", locale).into_owned())
            .child(
                Input::new(&self.title)
                    .id("task-title")
                    .aria_label(text("todo.title", locale).into_owned())
                    .disabled(self.busy),
            )
            .when_some(error, |view, error| {
                view.child(
                    div()
                        .id("task-title-error")
                        .test_support()
                        .role(Role::Alert)
                        .aria_label(message(error, locale))
                        .text_color(cx.theme().danger)
                        .child(message(error, locale)),
                )
            })
    }

    pub(super) fn render_editor(
        &self,
        window: &gpui_kit::Window,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let locale = self.locale();
        let creating = self
            .session
            .draft
            .as_ref()
            .is_some_and(|draft| draft.original.is_none());
        div()
            .id("todo-editor")
            .test_support()
            .flex()
            .flex_col()
            .min_w_0()
            .min_h_0()
            .h_full()
            .when(!self.presentation_wide, |view| {
                view.h((window.viewport_size().height
                    - gpui_kit::rems(5.).to_pixels(window.rem_size()))
                .min(gpui_kit::rems(30.).to_pixels(window.rem_size())))
            })
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .px_6()
                    .pt_6()
                    .pb_4()
                    .flex_shrink_0()
                    .gap_3()
                    .child(
                        div().font_weight(FontWeight::SEMIBOLD).child(
                            text(
                                if creating {
                                    "todo.new_title"
                                } else {
                                    "todo.edit_title"
                                },
                                locale,
                            )
                            .into_owned(),
                        ),
                    )
                    .child(
                        Button::new("editor-close")
                            .ghost()
                            .small()
                            .icon(IconName::Close)
                            .accessibility_label(text("todo.close_editor", locale).into_owned())
                            .disabled(self.busy)
                            .on_click(cx.listener(|this, _, window, cx| {
                                this.request(Destination::CloseEditor, window, cx)
                            })),
                    ),
            )
            .child(
                div()
                    .id("editor-fields")
                    .test_support()
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .px_6()
                    .flex()
                    .flex_col()
                    .gap_4()
                    .child(self.render_title_field(cx))
                    .child(div().flex_shrink_0().child(self.fields.clone()))
                    .child(
                        div()
                            .id("task-notes-field")
                            .test_support()
                            .flex_1()
                            .min_h(gpui_kit::rems(7.))
                            .flex()
                            .flex_col()
                            .gap_2()
                            .child(text("todo.notes", locale).into_owned())
                            .child(self.notes.clone()),
                    )
                    .when_some(
                        self.write_error
                            .as_ref()
                            .filter(|error| error.code != "todo:title_required"),
                        |view, error| {
                            view.child(
                                div()
                                    .id("editor-error")
                                    .test_support()
                                    .role(Role::Alert)
                                    .aria_label(message(error, locale))
                                    .text_color(cx.theme().danger)
                                    .child(message(error, locale)),
                            )
                        },
                    ),
            )
            .child(
                div()
                    .px_6()
                    .pt_4()
                    .pb_6()
                    .flex_shrink_0()
                    .flex()
                    .justify_end()
                    .gap_2()
                    .child(
                        Button::new("editor-cancel")
                            .icon(IconName::Close)
                            .label(text("todo.cancel", locale).into_owned())
                            .disabled(self.busy)
                            .on_click(cx.listener(|this, _, window, cx| {
                                this.request(Destination::CloseEditor, window, cx)
                            })),
                    )
                    .child(
                        Button::new("editor-save")
                            .icon(if creating {
                                gpui_kit::assets::IconName::Plus
                            } else {
                                gpui_kit::assets::IconName::Save
                            })
                            .primary()
                            .label(
                                text(if creating { "todo.create" } else { "todo.save" }, locale)
                                    .into_owned(),
                            )
                            .loading(self.writing_draft)
                            .disabled(self.busy)
                            .on_click(cx.listener(|this, _, window, cx| this.save(window, cx))),
                    ),
            )
    }
}
