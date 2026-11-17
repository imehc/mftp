//! Stable values, rather than translated labels, identify dropdown choices.
use crate::i18n::{Locale, text};
use gpui_kit::{
    App, Hsla, SharedString, Window,
    assets::IconName,
    component::{ActiveTheme, Icon, searchable_list::SearchableListItem},
    div,
    prelude::*,
};
use mftp_todo::model::TodoPriority;

#[derive(Clone)]
pub(super) struct Choice<T: Clone + PartialEq> {
    pub value: T,
    pub title: SharedString,
}

impl SearchableListItem for Choice<Option<TodoPriority>> {
    type Value = Option<TodoPriority>;
    fn title(&self) -> SharedString {
        self.title.clone()
    }
    fn value(&self) -> &Self::Value {
        &self.value
    }
    fn render(&self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        div()
            .flex()
            .items_center()
            .gap_2()
            .child(
                Icon::new(IconName::Flag)
                    .size_4()
                    .text_color(priority_color(self.value, cx)),
            )
            .child(self.title.clone())
    }
}

pub(super) fn priority_color(priority: Option<TodoPriority>, cx: &App) -> Hsla {
    match priority {
        Some(TodoPriority::High) => cx.theme().danger,
        Some(TodoPriority::Medium) => cx.theme().warning,
        Some(TodoPriority::Low) => cx.theme().info,
        None => cx.theme().muted_foreground,
    }
}

pub(super) fn priority_key(priority: Option<TodoPriority>) -> &'static str {
    match priority {
        None => "todo.no_priority",
        Some(TodoPriority::High) => "todo.priority_high",
        Some(TodoPriority::Medium) => "todo.priority_medium",
        Some(TodoPriority::Low) => "todo.priority_low",
    }
}

pub(super) fn priorities(locale: Locale, filtering: bool) -> Vec<Choice<Option<TodoPriority>>> {
    [
        None,
        Some(TodoPriority::High),
        Some(TodoPriority::Medium),
        Some(TodoPriority::Low),
    ]
    .into_iter()
    .map(|value| Choice {
        value,
        title: text(
            if value.is_none() && filtering {
                "todo.all_priorities"
            } else {
                priority_key(value)
            },
            locale,
        )
        .into_owned()
        .into(),
    })
    .collect()
}

pub(crate) fn view_key(view: mftp_todo::TodoView) -> &'static str {
    match view {
        mftp_todo::TodoView::Active => "todo.active",
        mftp_todo::TodoView::Overdue => "todo.overdue",
        mftp_todo::TodoView::Completed => "todo.completed",
        mftp_todo::TodoView::Abandoned => "todo.abandoned",
    }
}
