//! Reading has one primary state action; successful writes return to the collection.
use super::{Destination, TodoPage};
use crate::i18n::{Locale, text};
use gpui_kit::{
    Context, FontWeight, Role, TestSupportExt, Window,
    assets::IconName,
    component::{
        ActiveTheme, Disableable, Icon,
        button::{Button, ButtonVariants},
        menu::{DropdownMenu, PopupMenu, PopupMenuItem},
    },
    div,
    prelude::*,
};
use mftp_todo::model::TodoItem;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum DetailAction {
    Complete,
    Restore,
    Abandon,
}

impl TodoPage {
    pub(super) fn render_details(
        &self,
        window: &Window,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let locale = self.locale();
        let item = self
            .session
            .draft
            .as_ref()
            .and_then(|draft| draft.original.as_ref());
        let action = if item.is_some_and(|item| item.completed || item.abandoned) {
            DetailAction::Restore
        } else {
            DetailAction::Complete
        };
        div()
            .id("todo-details")
            .test_support()
            .key_context("TodoTaskDetails")
            .track_focus(&self.details_focus)
            .on_action(
                cx.listener(|this, _: &super::render::DeleteTask, window, cx| {
                    this.delete_detail(window, cx)
                }),
            )
            .flex()
            .flex_col()
            .h_full()
            .min_h_0()
            .min_w_0()
            .when(!self.presentation_wide, |view| {
                view.h(gpui_kit::rems(26.).to_pixels(window.rem_size()).min(
                    window.viewport_size().height - gpui_kit::rems(5.).to_pixels(window.rem_size()),
                ))
            })
            .child(
                div()
                    .px_6()
                    .pt_6()
                    .pb_4()
                    .flex_shrink_0()
                    .flex()
                    .items_center()
                    .justify_between()
                    .gap_3()
                    .child(
                        div()
                            .id("details-title")
                            .test_support()
                            .role(Role::Heading)
                            .flex_1()
                            .min_w_0()
                            .text_xl()
                            .font_weight(FontWeight::SEMIBOLD)
                            .when_some(item, |view, item| {
                                view.aria_label(item.title.clone())
                                    .child(item.title.clone())
                            }),
                    )
                    .child(
                        Button::new("details-close")
                            .ghost()
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
                    .id("details-content")
                    .test_support()
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .px_6()
                    .flex()
                    .flex_col()
                    .gap_4()
                    .when_some(item, |view, item| {
                        view.when(has_metadata(item), |view| {
                            view.child(
                                div()
                                    .id("details-metadata")
                                    .test_support()
                                    .flex()
                                    .flex_wrap()
                                    .items_center()
                                    .gap_3()
                                    .when(
                                        item.category.is_some() || item.priority.is_some(),
                                        |view| {
                                            view.child(
                                                div().id("details-tags").test_support().child(
                                                    super::metadata_tags::render_tags(item, locale),
                                                ),
                                            )
                                        },
                                    )
                                    .when(
                                        item.due_date.is_some()
                                            || item.due_at.is_some()
                                            || item.completed
                                            || item.abandoned,
                                        |view| view.child(render_schedule(item, locale, cx)),
                                    ),
                            )
                        })
                    })
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap_2()
                            .child(
                                div()
                                    .text_color(cx.theme().muted_foreground)
                                    .child(text("todo.notes", locale).into_owned()),
                            )
                            .child(self.notes.clone()),
                    )
                    .when_some(self.write_error.as_ref(), |view, error| {
                        view.child(
                            div()
                                .id("details-error")
                                .test_support()
                                .role(Role::Alert)
                                .text_color(cx.theme().danger)
                                .aria_label(super::render::message(error, locale))
                                .child(super::render::message(error, locale)),
                        )
                    }),
            )
            .child(
                div()
                    .px_6()
                    .pt_4()
                    .pb_6()
                    .flex_shrink_0()
                    .flex()
                    .items_center()
                    .justify_between()
                    .gap_2()
                    .child(
                        Button::new("details-complete")
                            .primary()
                            .icon(if action == DetailAction::Restore {
                                IconName::RotateCcw
                            } else {
                                IconName::Check
                            })
                            .label(
                                text(
                                    if action == DetailAction::Restore {
                                        "todo.restore"
                                    } else {
                                        "todo.complete"
                                    },
                                    locale,
                                )
                                .into_owned(),
                            )
                            .disabled(self.busy)
                            .loading(self.detail_action == Some(action))
                            .on_click(cx.listener(move |this, _, window, cx| {
                                this.change_detail_state(action, window, cx)
                            })),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_2()
                            .child(
                                Button::new("details-edit")
                                    .icon(IconName::SquarePen)
                                    .label(text("todo.edit", locale).into_owned())
                                    .disabled(self.busy)
                                    .on_click(cx.listener(|this, _, window, cx| {
                                        this.editing = true;
                                        this.write_error = None;
                                        this.update_input_labels(window, cx);
                                        this.title.update(cx, |input, cx| input.focus(window, cx));
                                        cx.notify();
                                    })),
                            )
                            .child(self.detail_menu(item, locale, cx)),
                    ),
            )
    }

    fn detail_menu(
        &self,
        item: Option<&TodoItem>,
        locale: Locale,
        cx: &Context<Self>,
    ) -> impl IntoElement {
        let owner = cx.weak_entity();
        let snapshot = item.cloned();
        let abandoned = item.is_some_and(|item| item.abandoned);
        Button::new("details-more")
            .ghost()
            .icon(IconName::Ellipsis)
            .accessibility_label(text("todo.more", locale).into_owned())
            .disabled(self.busy)
            .dropdown_menu(move |menu, window, cx| {
                let information = snapshot.clone();
                let abandon_owner = owner.clone();
                let delete_owner = owner.clone();
                menu.submenu_with_icon(
                    Some(Icon::new(IconName::Info)),
                    text("todo.info", locale).into_owned(),
                    window,
                    cx,
                    move |menu, _, _| render_information(menu, information.as_ref(), locale),
                )
                .separator()
                .when(!abandoned, |menu| {
                    menu.item(
                        PopupMenuItem::new(text("todo.abandon", locale).into_owned())
                            .icon(IconName::Archive)
                            .on_click(move |_, window, cx| {
                                let owner = abandon_owner.clone();
                                window.defer(cx, move |window, cx| {
                                    let _ = owner.update(cx, |page, cx| {
                                        page.change_detail_state(DetailAction::Abandon, window, cx)
                                    });
                                });
                            }),
                    )
                })
                .separator()
                .item(
                    PopupMenuItem::new(text("todo.delete", locale).into_owned())
                        .icon(IconName::Trash)
                        .on_click(move |_, window, cx| {
                            let owner = delete_owner.clone();
                            window.defer(cx, move |window, cx| {
                                let _ = owner.update(cx, |page, cx| page.delete_detail(window, cx));
                            });
                        }),
                )
            })
    }

    fn delete_detail(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if let Some((item, revision)) = self
            .session
            .draft
            .as_ref()
            .and_then(|draft| Some((draft.original.clone()?, draft.revision?)))
        {
            self.confirm_delete_item(item, revision, window, cx);
        }
    }

    fn change_detail_state(
        &mut self,
        action: DetailAction,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.busy || self.editing {
            return;
        }
        let Some(draft) = self.session.draft.as_ref() else {
            return;
        };
        let (Some(item), Some(revision)) = (draft.original.as_ref(), draft.revision) else {
            return;
        };
        let id = item.id.clone();
        let task = match action {
            DetailAction::Abandon => self.client.set_abandoned(id.clone(), true, revision),
            DetailAction::Restore if item.abandoned => {
                self.client.set_abandoned(id.clone(), false, revision)
            }
            DetailAction::Restore => self.client.set_completed(id.clone(), false, revision),
            DetailAction::Complete => self.client.set_completed(id.clone(), true, revision),
        };
        self.write_error = None;
        self.detail_action = Some(action);
        self.set_busy(true, cx);
        self.finish_row_write(id, task, window, cx);
    }
}

fn has_metadata(item: &TodoItem) -> bool {
    item.category.is_some()
        || item.priority.is_some()
        || item.due_date.is_some()
        || item.due_at.is_some()
        || item.completed
        || item.abandoned
}

fn render_schedule(item: &TodoItem, locale: Locale, cx: &gpui_kit::App) -> impl IntoElement {
    let planned = item
        .due_at
        .map(|time| super::presentation::timestamp(time, locale))
        .or_else(|| item.due_date.clone());
    let closure =
        mftp_todo::closure_time(item).map(|time| super::presentation::timestamp(time, locale));
    div()
        .flex()
        .flex_wrap()
        .items_center()
        .gap_3()
        .text_color(cx.theme().muted_foreground)
        .when_some(planned, |view, planned| {
            view.child(
                div()
                    .id("details-planned")
                    .test_support()
                    .role(Role::Label)
                    .aria_label(planned.clone())
                    .flex()
                    .items_center()
                    .gap_2()
                    .child(Icon::new(IconName::Clock).size_4())
                    .child(planned),
            )
        })
        .when(item.completed || item.abandoned, |view| {
            view.child(
                div()
                    .flex()
                    .items_center()
                    .gap_2()
                    .child(
                        Icon::new(if item.abandoned {
                            IconName::Archive
                        } else {
                            IconName::Check
                        })
                        .size_4(),
                    )
                    .child(
                        text(
                            if item.abandoned {
                                "todo.abandoned"
                            } else {
                                "todo.completed"
                            },
                            locale,
                        )
                        .into_owned(),
                    )
                    .when_some(closure, |view, time| view.child(time)),
            )
        })
}

fn render_information(mut menu: PopupMenu, item: Option<&TodoItem>, locale: Locale) -> PopupMenu {
    let mut rows = Vec::new();
    if let Some(item) = item {
        rows.push((
            "todo.created_at",
            super::presentation::timestamp(item.created_at, locale),
        ));
        rows.push((
            "todo.updated_at",
            super::presentation::timestamp(item.updated_at, locale),
        ));
        if item.completed || item.abandoned {
            rows.push((
                if item.abandoned {
                    "todo.abandoned_at"
                } else {
                    "todo.completed_at"
                },
                mftp_todo::closure_time(item)
                    .map(|time| super::presentation::timestamp(time, locale))
                    .unwrap_or_else(|| text("todo.untracked", locale).into_owned()),
            ));
        }
    }
    for (key, value) in rows {
        menu = menu.label(format!("{}: {}", text(key, locale), value));
    }
    menu
}
