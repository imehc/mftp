//! Category and priority have explicit text and distinct symbols; color is supplementary.
use crate::i18n::{Locale, text};
use gpui_kit::{
    assets::IconName,
    component::{Icon, Sizable, tag::Tag},
    div,
    prelude::*,
};
use mftp_todo::model::{TodoItem, TodoPriority};

pub(super) fn render_tags(item: &TodoItem, locale: Locale) -> impl IntoElement {
    div()
        .flex()
        .items_center()
        .gap_2()
        .flex_shrink_0()
        .when_some(item.category.as_ref(), |view, category| {
            view.child(
                Tag::secondary().small().child(
                    div()
                        .flex()
                        .items_center()
                        .gap_1()
                        .max_w_24()
                        .child(Icon::new(IconName::Tag).size_3())
                        .child(div().min_w_0().text_ellipsis().child(category.clone())),
                ),
            )
        })
        .when_some(item.priority, |view, priority| {
            let key = match priority {
                TodoPriority::High => "todo.priority_high_label",
                TodoPriority::Medium => "todo.priority_medium_label",
                TodoPriority::Low => "todo.priority_low_label",
            };
            let tag = match priority {
                TodoPriority::High => Tag::danger(),
                TodoPriority::Medium => Tag::warning(),
                TodoPriority::Low => Tag::info(),
            };
            view.child(
                tag.small().child(
                    div()
                        .flex()
                        .items_center()
                        .gap_1()
                        .child(Icon::new(IconName::Flag).size_3())
                        .child(text(key, locale).into_owned()),
                ),
            )
        })
}
