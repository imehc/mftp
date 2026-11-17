//! Search and filters share a toolbar, while each control retains its own focus boundary.
use super::choices::{priorities, priority_color};
use crate::i18n::{Locale, text};
use gpui_kit::{
    App, Context, EventEmitter, Pixels, Render, TestSupportExt, TextRun, Window,
    assets::IconName,
    component::{
        ActiveTheme, Icon, Selectable,
        button::Button,
        menu::{DropdownMenu, PopupMenuItem},
    },
    div,
    prelude::*,
    px, rems,
};
use mftp_todo::model::TodoPriority;

pub(super) struct FiltersChanged;

pub(super) struct TodoFilters {
    category: Option<String>,
    priority: Option<TodoPriority>,
    categories: Vec<String>,
    locale: Locale,
    expanded: bool,
}

impl EventEmitter<FiltersChanged> for TodoFilters {}

impl TodoFilters {
    pub fn new(_: &mut Window, _: &mut Context<Self>) -> Self {
        Self {
            category: None,
            priority: None,
            categories: Vec::new(),
            locale: Locale::English,
            expanded: true,
        }
    }
    pub fn value(&self, _: &App) -> (Option<String>, Option<TodoPriority>) {
        (self.category.clone(), self.priority)
    }
    pub fn set_expanded(&mut self, expanded: bool, cx: &mut Context<Self>) {
        if self.expanded != expanded {
            self.expanded = expanded;
            cx.notify();
        }
    }
    pub fn refresh(
        &mut self,
        locale: Locale,
        categories: Vec<String>,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.locale = locale;
        self.categories = categories;
        cx.notify();
    }
}

impl Render for TodoFilters {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let locale = self.locale;
        let category_label = self
            .category
            .clone()
            .unwrap_or_else(|| text("todo.category", locale).into_owned());
        let priority_label = if self.priority.is_some() {
            text(super::choices::priority_key(self.priority), locale).into_owned()
        } else {
            text("todo.priority", locale).into_owned()
        };
        let category = self.category.clone();
        let priority = self.priority;
        let owner = cx.weak_entity();
        let priority_owner = owner.clone();
        let mut categories = vec![None];
        categories.extend(self.categories.iter().cloned().map(Some));
        if category.is_some() && !categories.contains(&category) {
            categories.push(category.clone());
        }
        let priority_width = longest_label_width(
            priorities(locale, true)
                .iter()
                .map(|choice| choice.title.as_ref()),
            window,
            cx,
        )
        .max(longest_label_width([priority_label.as_str()], window, cx));
        let category_width = longest_label_width(
            categories
                .iter()
                .filter_map(|value| value.as_deref())
                .chain([
                    category_label.as_str(),
                    text("todo.all_categories", locale).as_ref(),
                ]),
            window,
            cx,
        );
        let expanded = self.expanded;
        div()
            .id("todo-filters")
            .test_support()
            .flex()
            .items_center()
            .gap_2()
            .flex_shrink_0()
            .child(
                Button::new("filter-priority")
                    .outline()
                    .icon(Icon::new(IconName::Flag).text_color(priority_color(priority, cx)))
                    .selected(priority.is_some())
                    .accessibility_label(text("todo.priority", locale).into_owned())
                    .tooltip(priority_label.clone())
                    .when(expanded, |button| {
                        button
                            .w(priority_width.min(rems(12.).to_pixels(window.rem_size())))
                            .child(
                                div()
                                    .flex_1()
                                    .min_w_0()
                                    .text_ellipsis()
                                    .child(priority_label),
                            )
                            .child(Icon::new(IconName::ChevronDown).size_3())
                    })
                    .dropdown_menu(move |menu, window, cx| {
                        priorities(locale, true).into_iter().fold(
                            menu.min_w(priority_width).max_w(
                                window.viewport_size().width
                                    - rems(3.).to_pixels(window.rem_size()),
                            ),
                            |menu, choice| {
                                let owner = priority_owner.clone();
                                let value = choice.value;
                                menu.item(
                                    PopupMenuItem::new(choice.title)
                                        .icon(
                                            Icon::new(IconName::Flag)
                                                .text_color(priority_color(value, cx)),
                                        )
                                        .checked(priority == value)
                                        .on_click(move |_, _, cx| {
                                            let _ = owner.update(cx, |filters, cx| {
                                                filters.priority = value;
                                                cx.emit(FiltersChanged);
                                                cx.notify();
                                            });
                                        }),
                                )
                            },
                        )
                    }),
            )
            .child(
                Button::new("filter-category")
                    .outline()
                    .icon(IconName::Tag)
                    .selected(category.is_some())
                    .accessibility_label(text("todo.category", locale).into_owned())
                    .tooltip(category_label.clone())
                    .when(expanded, |button| {
                        button
                            .w(category_width.min(rems(12.).to_pixels(window.rem_size())))
                            .child(
                                div()
                                    .flex_1()
                                    .min_w_0()
                                    .text_ellipsis()
                                    .child(category_label),
                            )
                            .child(Icon::new(IconName::ChevronDown).size_3())
                    })
                    .dropdown_menu(move |menu, window, _| {
                        categories.iter().fold(
                            menu.min_w(category_width).max_w(
                                window.viewport_size().width
                                    - rems(3.).to_pixels(window.rem_size()),
                            ),
                            |menu, value| {
                                let owner = owner.clone();
                                let selected = category == *value;
                                let value = value.clone();
                                let title = value.clone().unwrap_or_else(|| {
                                    text("todo.all_categories", locale).into_owned()
                                });
                                menu.item(PopupMenuItem::new(title).checked(selected).on_click(
                                    move |_, _, cx| {
                                        let value = value.clone();
                                        let _ = owner.update(cx, |filters, cx| {
                                            filters.category = value;
                                            cx.emit(FiltersChanged);
                                            cx.notify();
                                        });
                                    },
                                ))
                            },
                        )
                    }),
            )
    }
}

// Shape the actual localized font; character counts cannot predict CJK or mixed-script widths.
fn longest_label_width<'a>(
    labels: impl IntoIterator<Item = &'a str>,
    window: &Window,
    cx: &App,
) -> Pixels {
    let style = window.text_style();
    let font = style.font();
    let size = style.font_size.to_pixels(window.rem_size());
    labels
        .into_iter()
        .map(|label| {
            window
                .text_system()
                .shape_line(
                    label.to_owned().into(),
                    size,
                    &[TextRun {
                        len: label.len(),
                        font: font.clone(),
                        color: cx.theme().foreground,
                        background_color: None,
                        underline: None,
                        strikethrough: None,
                    }],
                    None,
                )
                .width
        })
        .fold(px(0.), Pixels::max)
        + rems(4.).to_pixels(window.rem_size())
}
