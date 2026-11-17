//! Controlled dialogs keep failed writes visible and never dismiss uncommitted input.

use super::{Destination, TodoPage, render::message};
use crate::i18n::text;
use gpui_kit::{
    AppContext, Context, Entity, EntityInputHandler, Render, Subscription, TestSupportExt,
    WeakEntity, Window,
    component::{
        ActiveTheme, Disableable, IconName, Sizable, WindowExt,
        button::{Button, ButtonVariant, ButtonVariants},
        dialog::DialogEntrance,
    },
    div,
    prelude::*,
};
use mftp_todo::TodoRecord;

struct TaskDialog {
    owner: WeakEntity<TodoPage>,
    _subscription: Subscription,
}

impl Render for TaskDialog {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.owner
            .update(cx, |page, cx| {
                if page.leave_destination.is_some() {
                    page.render_leave(cx).into_any_element()
                } else if page.editing {
                    page.render_editor(window, cx).into_any_element()
                } else {
                    page.render_details(window, cx).into_any_element()
                }
            })
            .unwrap_or_else(|_| div().into_any_element())
            .into_any_element()
            .map(|element| {
                div()
                    .key_context("TodoWorkspace TodoTaskDetails")
                    .max_h(
                        window.viewport_size().height
                            - gpui_kit::rems(5.).to_pixels(window.rem_size()),
                    )
                    .capture_action(cx.listener(
                        |this, _: &gpui_kit::base::input::Escape, window, cx| {
                            let _ = this.owner.update(cx, |page, cx| {
                                page.escape_was_composing =
                                    page.title.update(cx, |input, cx| {
                                        input.marked_text_range(window, cx).is_some()
                                    }) || page.notes.read(cx).is_composing(cx);
                            });
                        },
                    ))
                    .on_action(cx.listener(
                        |this, _: &gpui_kit::base::input::Escape, window, cx| {
                            let _ = this.owner.update(cx, |page, cx| {
                                if !page.escape_was_composing {
                                    page.cancel_task_dialog(window, cx);
                                }
                            });
                            cx.stop_propagation();
                        },
                    ))
                    .on_action(
                        cx.listener(|this, _: &super::render::SaveTask, window, cx| {
                            let _ = this.owner.update(cx, |page, cx| page.save(window, cx));
                        }),
                    )
                    .child(element)
            })
    }
}

impl TodoPage {
    pub(super) fn mount_task_dialog(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.modal_open {
            return;
        }
        self.modal_open = true;
        let owner = cx.entity();
        let view: Entity<TaskDialog> = cx.new(|cx| TaskDialog {
            owner: owner.downgrade(),
            _subscription: cx.observe(&owner, |_, _, cx| cx.notify()),
        });
        window.open_dialog(cx, move |dialog, window, cx| {
            let decision = owner.read(cx).leave_destination.is_some();
            dialog
                .centered()
                .w(gpui_kit::rems(if decision { 24. } else { 34. }).to_pixels(window.rem_size()))
                .p_0()
                .entrance(DialogEntrance::None)
                .close_button(false)
                .keyboard(false)
                .overlay_closable(false)
                .child(view.clone())
        });
        cx.notify();
    }

    pub(super) fn close_task_dialog(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.modal_open {
            window.close_dialog(cx);
        }
        self.modal_open = false;
        self.leave_destination = None;
        self.after_save = None;
    }

    fn cancel_task_dialog(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.busy {
            return;
        }
        if self.leave_destination.take().is_some() {
            if self.presentation_wide {
                self.close_task_dialog(window, cx);
            } else {
                self.title.update(cx, |input, cx| input.focus(window, cx));
            }
            cx.notify();
        } else {
            self.request(Destination::CloseEditor, window, cx);
        }
    }

    pub(super) fn confirm_leave(
        &mut self,
        destination: Destination,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.leave_destination = Some(destination);
        self.mount_task_dialog(window, cx);
        cx.notify();
    }

    fn render_leave(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let locale = self.locale();
        div()
            .id("save-decision")
            .test_support()
            .p_6()
            .flex()
            .flex_col()
            .gap_2()
            .child(
                div()
                    .flex()
                    .justify_between()
                    .items_center()
                    .child(
                        div()
                            .font_weight(gpui_kit::FontWeight::SEMIBOLD)
                            .child(text("todo.unsaved_title", locale).into_owned()),
                    )
                    .child(
                        Button::new("leave-close")
                            .ghost()
                            .small()
                            .icon(IconName::Close)
                            .accessibility_label(text("todo.keep_editing", locale).into_owned())
                            .disabled(self.busy)
                            .on_click(cx.listener(|this, _, window, cx| {
                                this.cancel_task_dialog(window, cx)
                            })),
                    ),
            )
            .child(text("todo.unsaved_body", locale).into_owned())
            .when_some(self.write_error.as_ref(), |view, error| {
                view.child(
                    div()
                        .id("leave-error")
                        .text_color(cx.theme().danger)
                        .child(message(error, locale)),
                )
            })
            .child(
                div()
                    .flex()
                    .justify_end()
                    .pt_4()
                    .gap_2()
                    .child(
                        Button::new("leave-discard")
                            .icon(gpui_kit::assets::IconName::Trash)
                            .danger()
                            .label(text("todo.discard", locale).into_owned())
                            .disabled(self.busy)
                            .on_click(cx.listener(|this, _, window, cx| {
                                let destination = this.leave_destination.take();
                                this.session.draft = None;
                                this.close_task_dialog(window, cx);
                                if let Some(destination) = destination {
                                    this.navigate(destination, window, cx);
                                }
                            })),
                    )
                    .child(
                        Button::new("leave-save")
                            .icon(gpui_kit::assets::IconName::Save)
                            .primary()
                            .label(text("todo.save_changes", locale).into_owned())
                            .loading(self.writing_draft)
                            .disabled(self.busy)
                            .on_click(cx.listener(|this, _, window, cx| {
                                this.after_save = this.leave_destination.clone();
                                this.save(window, cx);
                            })),
                    ),
            )
    }

    pub(super) fn confirm_delete(
        &mut self,
        record: TodoRecord,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let revision = record.revision();
        self.confirm_delete_item(record.into_item(), revision, window, cx);
    }

    pub(super) fn confirm_delete_item(
        &mut self,
        item: mftp_todo::model::TodoItem,
        revision: i64,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.busy
            || self
                .session
                .draft
                .as_ref()
                .is_some_and(super::super::session::Draft::is_dirty)
        {
            return;
        }
        let locale = self.locale();
        let owner = cx.weak_entity();
        window.open_alert_dialog(cx, move |dialog, _, _| {
            let owner = owner.clone();
            let item = item.clone();
            dialog
                .title(text("todo.delete_title", locale).into_owned())
                .description(text("todo.delete_body", locale).into_owned())
                .child(div().text_ellipsis().child(item.title.clone()))
                .entrance(DialogEntrance::None)
                .confirm()
                .button_props(
                    gpui_kit::component::dialog::DialogButtonProps::default()
                        .ok_text(text("todo.delete", locale).into_owned())
                        .ok_variant(ButtonVariant::Danger)
                        .cancel_text(text("todo.cancel", locale).into_owned()),
                )
                .on_ok(move |_, window, cx| {
                    let item = item.clone();
                    let _ = owner.update(cx, |page, cx| {
                        if page.busy {
                            return;
                        }
                        page.busy = true;
                        page.write_error = None;
                        let id = item.id.clone();
                        let task = page.client.delete(id.clone(), revision);
                        page.finish_row_write(id, task, window, cx);
                    });
                    true
                })
        });
    }
}
