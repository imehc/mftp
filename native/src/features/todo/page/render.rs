//! Layout owns one list viewport and one editor viewport; controls retain native behavior.

use super::{Destination, TodoPage};
use crate::i18n::{Locale, text};
use gpui_kit::component::Sizable;
use gpui_kit::{
    Context, EntityInputHandler, FontWeight, KeyBinding, Render, Role, TestSupportExt, Window,
    component::{
        ActiveTheme, Disableable, ElementExt, IconName, button::Button, input::Input, list::List,
    },
    div,
    prelude::*,
};
use mftp_foundation::AppError;

gpui_kit::actions!(
    native_todo,
    [NewTask, SearchTasks, SaveTask, ToggleCompleted, DeleteTask]
);

pub(crate) fn bind_keys(cx: &mut gpui_kit::App) {
    let [new, search, save, delete] = if cfg!(target_os = "macos") {
        ["cmd-n", "cmd-f", "cmd-s", "cmd-backspace"]
    } else {
        ["ctrl-n", "ctrl-f", "ctrl-s", "ctrl-backspace"]
    };
    cx.bind_keys([
        KeyBinding::new(new, NewTask, Some("TodoWorkspace")),
        KeyBinding::new(search, SearchTasks, Some("TodoWorkspace")),
        KeyBinding::new(save, SaveTask, Some("TodoWorkspace")),
        KeyBinding::new(
            "escape",
            gpui_kit::base::input::Escape,
            Some("TodoWorkspace"),
        ),
        KeyBinding::new("space", ToggleCompleted, Some("TodoList && !Input")),
        KeyBinding::new(delete, DeleteTask, Some("TodoList && !Input")),
        KeyBinding::new(delete, DeleteTask, Some("TodoTaskDetails && !Input")),
    ]);
}

fn specific_message_key(error: &AppError) -> Option<&'static str> {
    match error.code.as_str() {
        "todo:due_date_invalid" => Some("errors.due_date_invalid"),
        "todo:due_time_invalid" => Some("errors.due_time_invalid"),
        "todo:title_required" => Some("errors.title_required"),
        "todo:note_conflict" => Some("errors.conflict"),
        "todo:item_not_found" => Some("errors.not_found"),
        "todo:worker_busy" => Some("errors.queue_busy"),
        "io:permission_denied" => Some("errors.permission"),
        "native:state_invalid" => Some("errors.state_invalid"),
        "native:rich_text_invalid" => Some("rich_text.invalid"),
        "native:image_missing" | "todo:note_image_missing" => Some("rich_text.image_missing"),
        _ => None,
    }
}

pub(super) fn message(error: &AppError, locale: Locale) -> String {
    text(
        specific_message_key(error).unwrap_or("errors.operation"),
        locale,
    )
    .into_owned()
}

impl TodoPage {
    fn render_collection(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let locale = self.locale();
        let has_records = !self.rows.read(cx).delegate().records.is_empty();
        let query = !self.search.read(cx).value().trim().is_empty();
        div()
            .flex()
            .flex_col()
            .flex_1()
            .min_w_0()
            .min_h_0()
            .h_full()
            .child(
                div()
                    .on_prepaint({
                        let filters = self.filters.downgrade();
                        move |bounds, window, cx| {
                            let expanded = bounds.size.width
                                >= gpui_kit::rems(40.).to_pixels(window.rem_size());
                            let _ = filters
                                .update(cx, |filters, cx| filters.set_expanded(expanded, cx));
                        }
                    })
                    .p_6()
                    .flex()
                    .flex_col()
                    .gap_4()
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .justify_between()
                            .gap_3()
                            .child(
                                div()
                                    .text_xl()
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .child(text(super::view_key(self.view), locale).into_owned()),
                            )
                            .child(
                                Button::new("todo-new")
                                    .track_focus(&self.new_focus)
                                    .icon(IconName::Plus)
                                    .label(text("todo.new", locale).into_owned())
                                    .disabled(!self.initialized || self.busy)
                                    .on_click(cx.listener(|this, _, window, cx| {
                                        this.request(Destination::New, window, cx)
                                    })),
                            ),
                    )
                    .child(
                        div()
                            .id("todo-search-toolbar")
                            .test_support()
                            .flex()
                            .items_center()
                            .gap_2()
                            .child(
                                div().flex_1().min_w_0().child(
                                    Input::new(&self.search)
                                        .id("todo-search")
                                        .aria_label(text("todo.search", locale).into_owned())
                                        .prefix(IconName::Search)
                                        .cleanable(true)
                                        .disabled(!self.initialized),
                                ),
                            )
                            .child(self.filters.clone()),
                    ),
            )
            .when(self.loading, |view| {
                view.child(
                    div()
                        .id("todo-loading")
                        .test_support()
                        .role(Role::Status)
                        .aria_label(text("todo.loading", locale).into_owned())
                        .px_6()
                        .text_color(cx.theme().muted_foreground)
                        .child(text("todo.loading", locale).into_owned()),
                )
            })
            .when_some(self.read_error.as_ref(), |view, error| {
                view.child(
                    div()
                        .id("todo-read-error")
                        .test_support()
                        .role(Role::Alert)
                        .aria_label(if self.initialized {
                            message(error, locale)
                        } else {
                            text("errors.startup", locale).into_owned()
                        })
                        .px_6()
                        .pb_4()
                        .flex()
                        .flex_col()
                        .gap_2()
                        .text_color(cx.theme().danger)
                        .child(if self.initialized {
                            message(error, locale)
                        } else {
                            text("errors.startup", locale).into_owned()
                        })
                        .when(self.initialized, |view| {
                            view.child(
                                Button::new("todo-retry")
                                    .label(text("todo.retry", locale).into_owned())
                                    .on_click(
                                        cx.listener(|this, _, window, cx| this.reload(window, cx)),
                                    ),
                            )
                        }),
                )
            })
            .when(self.session.draft.is_none(), |view| {
                view.when_some(self.write_error.as_ref(), |view, error| {
                    view.child(
                        div()
                            .id("todo-write-error")
                            .test_support()
                            .role(Role::Alert)
                            .aria_label(message(error, locale))
                            .px_6()
                            .pb_4()
                            .text_color(cx.theme().danger)
                            .child(message(error, locale)),
                    )
                })
            })
            .when(
                self.initialized && !has_records && !self.loading && self.read_error.is_none(),
                |view| {
                    view.child(
                        div()
                            .id("todo-empty")
                            .test_support()
                            .flex_1()
                            .p_6()
                            .flex()
                            .flex_col()
                            .items_center()
                            .justify_center()
                            .gap_3()
                            .text_color(cx.theme().muted_foreground)
                            .child(
                                text(
                                    if query {
                                        "todo.no_results"
                                    } else if self.view == mftp_todo::TodoView::Overdue {
                                        "todo.empty_overdue"
                                    } else if self.view == mftp_todo::TodoView::Abandoned {
                                        "todo.empty_abandoned"
                                    } else if self.view == mftp_todo::TodoView::Completed {
                                        "todo.empty_completed"
                                    } else {
                                        "todo.empty_active"
                                    },
                                    locale,
                                )
                                .into_owned(),
                            )
                            .when(query, |view| {
                                view.child(
                                    Button::new("todo-clear-search")
                                        .label(text("todo.clear_search", locale).into_owned())
                                        .on_click(cx.listener(|this, _, window, cx| {
                                            this.search.update(cx, |input, cx| {
                                                input.set_value("", window, cx)
                                            });
                                            this.reload(window, cx);
                                        })),
                                )
                            }),
                    )
                },
            )
            .when(has_records, |view| {
                view.child(
                    div()
                        .id("todo-list-region")
                        .key_context("TodoList")
                        .flex_1()
                        .min_h_0()
                        .px_4()
                        .on_action(cx.listener(|this, _: &ToggleCompleted, window, cx| {
                            let selected = this.rows.read(cx).delegate().selected();
                            if let Some(record) = selected {
                                this.change_completed(record, window, cx);
                            }
                        }))
                        .on_action(cx.listener(|this, _: &DeleteTask, window, cx| {
                            let selected = this.rows.read(cx).delegate().selected();
                            if let Some(record) = selected {
                                this.confirm_delete(record, window, cx);
                            }
                        }))
                        .child(List::new(&self.rows)),
                )
            })
    }
}

impl Render for TodoPage {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let locale = self.locale();
        let pane_open = self.session.draft.is_some();
        let wide = super::presentation_mode::wide(window);
        div()
            .id("todo-page")
            .key_context("TodoWorkspace")
            .on_prepaint({
                let owner = cx.weak_entity();
                move |_, window, cx| {
                    let wide = super::presentation_mode::wide(window);
                    let _ = owner.update(cx, |page, cx| {
                        if page.presentation_wide != wide {
                            page.presentation_wide = wide;
                            let handle = window.window_handle();
                            let owner = cx.weak_entity();
                            cx.defer(move |cx| {
                                let _ = handle.update(cx, |_, window, cx| {
                                    let _ =
                                        owner.update(cx, |page, cx| page.present_task(window, cx));
                                });
                            });
                        }
                    });
                }
            })
            .size_full()
            .flex()
            .flex_col()
            .min_w_0()
            .min_h_0()
            .capture_action(
                cx.listener(|this, _: &gpui_kit::base::input::Escape, window, cx| {
                    // The Kit input unmarks before propagating Escape; remember preedit first.
                    this.escape_was_composing = this.title.update(cx, |input, cx| {
                        input.marked_text_range(window, cx).is_some()
                    }) || this.notes.read(cx).is_composing(cx);
                }),
            )
            .on_action(
                cx.listener(|this, _: &gpui_kit::base::input::Escape, window, cx| {
                    if this.escape_was_composing {
                        this.capture_draft(window, cx);
                    } else {
                        this.request(Destination::CloseEditor, window, cx);
                    }
                }),
            )
            .on_action(cx.listener(|this, _: &NewTask, window, cx| {
                this.request(Destination::New, window, cx)
            }))
            .on_action(cx.listener(|this, _: &SearchTasks, window, cx| {
                this.request(Destination::Search, window, cx);
            }))
            .on_action(cx.listener(|this, _: &SaveTask, window, cx| this.save(window, cx)))
            .when_some(self.persistence_error.as_ref(), |view, error| {
                let detail = specific_message_key(error).map(|key| text(key, locale).into_owned());
                let recovery = text("errors.persistence", locale).into_owned();
                let accessible = detail
                    .as_ref()
                    .map_or_else(|| recovery.clone(), |detail| format!("{recovery} {detail}"));
                view.child(
                    div()
                        .id("state-error")
                        .test_support()
                        .role(Role::Alert)
                        .aria_label(accessible)
                        .px_6()
                        .pt_4()
                        .flex()
                        .items_start()
                        .gap_3()
                        .text_color(cx.theme().danger)
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .flex()
                                .flex_col()
                                .gap_2()
                                .child(recovery)
                                .when_some(detail, |view, detail| {
                                    view.child(div().text_sm().child(detail))
                                }),
                        )
                        .child(
                            Button::new("state-retry")
                                .small()
                                .flex_shrink_0()
                                .label(text("todo.retry", locale).into_owned())
                                .on_click(
                                    cx.listener(|this, _, window, cx| this.persist(window, cx)),
                                ),
                        ),
                )
            })
            .child(
                div()
                    .flex()
                    .items_stretch()
                    .flex_1()
                    .min_w_0()
                    .min_h_0()
                    .child(self.render_collection(cx))
                    .when(pane_open && wide, |view| {
                        view.child(
                            div()
                                .w(gpui_kit::rems(34.))
                                .flex_shrink_0()
                                .border_l_1()
                                .border_color(cx.theme().border)
                                .min_w_0()
                                .min_h_0()
                                .child(if self.editing {
                                    self.render_editor(window, cx).into_any_element()
                                } else {
                                    self.render_details(window, cx).into_any_element()
                                }),
                        )
                    }),
            )
    }
}
