//! Native window composition; todo workflows remain behind the feature boundary.

use super::{Settings, commands};
use crate::{
    features::todo::{
        TodoClient, TodoTask,
        page::{Destination, OpenSettings, TodoPage},
    },
    i18n::text,
    platform::AppPaths,
    preferences::Preferences,
};
use gpui_kit::component::button::ButtonVariants;
use gpui_kit::{
    AppContext, Context, Entity, Render, Subscription, Window,
    assets::IconName,
    component::{ActiveTheme, Disableable, Icon, Selectable, button::Button},
    div,
    prelude::*,
};
use mftp_todo::TodoView;

pub(super) struct Workspace {
    todo: Entity<TodoPage>,
    settings: Entity<Settings>,
    settings_open: bool,
    _subscriptions: Vec<Subscription>,
}

impl Workspace {
    #[cfg(test)]
    pub(super) fn todo_for_test(&self) -> Entity<TodoPage> {
        self.todo.clone()
    }

    pub fn new(
        paths: AppPaths,
        client: TodoClient,
        ready: TodoTask<()>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let settings = cx.new(|cx| Settings::new(paths, window, cx));
        let todo = cx.new(|cx| TodoPage::new(client.clone(), window, cx));
        let settings_event = cx.subscribe_in(&todo, window, |this, _, _: &OpenSettings, _, cx| {
            this.settings_open = true;
            cx.notify();
        });
        let preferences_event = cx.subscribe_in(
            &settings,
            window,
            |this, _, preferences: &Preferences, window, cx| {
                this.todo.update(cx, |page, cx| {
                    page.set_preferences(*preferences, window, cx)
                });
                commands::update_menu(this.settings.read(cx).locale(), cx);
                cx.notify();
            },
        );
        let observed = cx.observe(&todo, |_, _, cx| cx.notify());
        let observed_settings = cx.observe(&settings, |_, _, cx| cx.notify());
        let owner = cx.weak_entity();
        let quit_owner = owner.clone();
        let handle = window.window_handle();
        gpui_kit::App::on_action(cx, move |_: &commands::Quit, cx| {
            // App commands remain available after controls blur or a modal takes focus.
            // Defer because global dispatch may still hold the window's update borrow.
            let owner = quit_owner.clone();
            cx.defer(move |cx| {
                let _ = handle.update(cx, |_, window, cx| {
                    let _ = owner.update(cx, |workspace, cx| workspace.request_quit(window, cx));
                });
            });
        });
        window.on_window_should_close(cx, move |window, cx| {
            owner
                .update(cx, |workspace, cx| {
                    workspace.settings_open = false;
                    cx.notify();
                    workspace
                        .todo
                        .update(cx, |page, cx| page.request_close(window, cx))
                })
                .unwrap_or(true)
        });
        cx.spawn_in(window, async move |this, cx| {
            let session = match ready.await {
                Ok(()) => match client.load_session() {
                    Ok(task) => task.await,
                    Err(error) => Err(error),
                },
                Err(error) => Err(error),
            };
            let _ = this.update_in(cx, |this, window, cx| {
                match session {
                    Ok(session) => {
                        this.settings.update(cx, |settings, cx| {
                            settings.restore(session.preferences, window, cx)
                        });
                        this.todo
                            .update(cx, |page, cx| page.restore(session, window, cx));
                        commands::update_menu(this.settings.read(cx).locale(), cx);
                    }
                    Err(error) => this
                        .todo
                        .update(cx, |page, cx| page.startup_error(error, cx)),
                }
                cx.notify();
            });
        })
        .detach();
        commands::update_menu(settings.read(cx).locale(), cx);
        Self {
            todo,
            settings,
            settings_open: false,
            _subscriptions: vec![
                settings_event,
                preferences_event,
                observed,
                observed_settings,
            ],
        }
    }

    fn show_tasks(&mut self, view: TodoView, window: &mut Window, cx: &mut Context<Self>) {
        let returning = self.settings_open && self.todo.read(cx).view() == view;
        self.settings_open = false;
        if !returning {
            self.todo.update(cx, |page, cx| {
                page.request(Destination::View(view), window, cx)
            });
        }
        cx.notify();
    }

    fn request_quit(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.settings_open = false;
        if self
            .todo
            .update(cx, |page, cx| page.request_close(window, cx))
        {
            window.remove_window();
        }
        cx.notify();
    }
}

#[cfg(test)]
#[path = "workspace_tests.rs"]
mod tests;

fn navigation_button(id: &'static str, label: String, icon: IconName) -> Button {
    // Button owns keyboard/focus behavior; only its content is aligned as navigation.
    Button::new(id)
        .ghost()
        .accessibility_label(label.clone())
        .w_full()
        .px_2()
        .child(
            div()
                .flex()
                .items_center()
                .gap_2()
                .w_full()
                .min_w_0()
                .child(Icon::new(icon).size_4())
                .child(div().min_w_0().text_ellipsis().child(label)),
        )
}

impl Render for Workspace {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let locale = self.settings.read(cx).locale();
        let busy = self.todo.read(cx).is_busy();
        let view = self.todo.read(cx).view();
        div()
            .id("workspace")
            .size_full()
            .flex()
            .items_stretch()
            .bg(cx.theme().background)
            .text_color(cx.theme().foreground)
            .text_sm()
            .child(
                div()
                    .w(gpui_kit::rems(13.))
                    .flex_shrink_0()
                    .h_full()
                    .flex()
                    .flex_col()
                    .p_4()
                    .gap_6()
                    .bg(cx.theme().sidebar)
                    .text_color(cx.theme().sidebar_foreground)
                    .border_r_1()
                    .border_color(cx.theme().border)
                    .child(
                        div()
                            .h_10()
                            .flex()
                            .items_center()
                            .px_2()
                            .font_weight(gpui_kit::FontWeight::SEMIBOLD)
                            .child("MFTP Native"),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap_1()
                            .children(TodoView::ALL.into_iter().map(|current| {
                                let (id, icon) = match current {
                                    TodoView::Active => ("nav-active", IconName::Inbox),
                                    TodoView::Overdue => ("nav-overdue", IconName::Clock),
                                    TodoView::Completed => ("nav-completed", IconName::Check),
                                    TodoView::Abandoned => ("nav-abandoned", IconName::Archive),
                                };
                                navigation_button(
                                    id,
                                    format!(
                                        "{}  {}",
                                        text(
                                            crate::features::todo::page::view_key(current),
                                            locale
                                        ),
                                        self.todo.read(cx).count(current)
                                    ),
                                    icon,
                                )
                                .selected(!self.settings_open && view == current)
                                .disabled(busy)
                                .on_click(cx.listener(
                                    move |this, _, window, cx| this.show_tasks(current, window, cx),
                                ))
                            })),
                    )
                    .child(div().flex_1())
                    .child(
                        navigation_button(
                            "nav-settings",
                            text("settings.title", locale).into_owned(),
                            IconName::Settings,
                        )
                        .selected(self.settings_open)
                        .disabled(busy)
                        .on_click(cx.listener(|this, _, window, cx| {
                            this.todo.update(cx, |page, cx| {
                                page.request(Destination::Settings, window, cx)
                            })
                        })),
                    ),
            )
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .min_h_0()
                    .when(self.settings_open, |view| view.child(self.settings.clone()))
                    .when(!self.settings_open, |view| view.child(self.todo.clone())),
            )
    }
}
