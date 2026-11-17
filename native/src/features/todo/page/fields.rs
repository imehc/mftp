//! Retained metadata controls own input behavior; the page owns draft persistence.
use super::super::metadata::Metadata;
use super::choices::{Choice, priorities};
use crate::i18n::{Locale, text};
use gpui_kit::{
    App, AppContext, Context, Entity, EventEmitter, Render, Subscription, TestSupportExt, Window,
    component::{
        Disableable, IconName, IndexPath, Sizable,
        button::{Button, ButtonVariants},
        calendar::Date,
        checkbox::Checkbox,
        date_picker::{DatePicker, DatePickerEvent, DatePickerState},
        input::{Input, InputEvent, InputState},
        menu::{DropdownMenu, PopupMenuItem},
        select::{Select, SelectEvent, SelectState},
        time_field::{HourCycle, TimeField, TimeFieldEvent, TimeFieldState},
    },
    div,
    prelude::*,
};
use mftp_todo::model::TodoPriority;

pub(super) struct FieldsChanged;

pub(super) struct MetadataFields {
    pub category: Entity<InputState>,
    pub priority: Entity<SelectState<Vec<Choice<Option<TodoPriority>>>>>,
    pub date: Entity<DatePickerState>,
    pub time: Entity<TimeFieldState>,
    time_enabled: bool,
    baseline: Metadata,
    categories: Vec<String>,
    locale: Locale,
    disabled: bool,
    syncing: bool,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<FieldsChanged> for MetadataFields {}

impl MetadataFields {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let category = cx.new(|cx| InputState::new(window, cx));
        let priority = cx.new(|cx| {
            SelectState::new(
                priorities(Locale::English, false),
                Some(IndexPath::new(0)),
                window,
                cx,
            )
        });
        let date = cx.new(|cx| DatePickerState::new(window, cx));
        let time = cx.new(|cx| TimeFieldState::new(window, cx).hour_cycle(HourCycle::H23));
        let subscriptions = vec![
            cx.subscribe(&category, |this, _, event: &InputEvent, cx| {
                if matches!(event, InputEvent::Change) {
                    this.changed(cx);
                }
            }),
            cx.subscribe(
                &priority,
                |this, _, _: &SelectEvent<Vec<Choice<Option<TodoPriority>>>>, cx| this.changed(cx),
            ),
            cx.subscribe(&date, |this, _, _: &DatePickerEvent, cx| this.changed(cx)),
            cx.subscribe(&time, |this, _, _: &TimeFieldEvent, cx| this.changed(cx)),
        ];
        Self {
            category,
            priority,
            date,
            time,
            time_enabled: false,
            baseline: Metadata::default(),
            categories: Vec::new(),
            locale: Locale::English,
            disabled: false,
            syncing: false,
            _subscriptions: subscriptions,
        }
    }

    fn changed(&mut self, cx: &mut Context<Self>) {
        if !self.syncing && !self.disabled {
            cx.emit(FieldsChanged);
        }
        cx.notify();
    }

    pub fn set_disabled(&mut self, disabled: bool, cx: &mut Context<Self>) {
        self.disabled = disabled;
        cx.notify();
    }

    pub fn snapshot(&self, cx: &App) -> Metadata {
        let mut value = self.baseline.clone();
        value.category = self.category.read(cx).value().to_string();
        value.priority = self.priority.read(cx).selected_value().copied().flatten();
        value.date = self
            .date
            .read(cx)
            .date_time()
            .start()
            .map(|date| date.format("%Y-%m-%d").to_string());
        value.time = if self.time_enabled {
            Some(self.time.read(cx).time().format("%H:%M").to_string())
        } else {
            None
        };
        if let Ok(instant) = value.validate() {
            value.instant = instant;
        }
        value
    }

    pub fn set_value(&mut self, value: Metadata, window: &mut Window, cx: &mut Context<Self>) {
        self.syncing = true;
        self.category.update(cx, |input, cx| {
            input.set_value(value.category.clone(), window, cx)
        });
        self.priority.update(cx, |select, cx| {
            select.set_selected_value(&value.priority, window, cx)
        });
        self.date.update(cx, |date, cx| {
            date.set_date(
                Date::Single(
                    value.date.as_deref().and_then(|value| {
                        chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").ok()
                    }),
                ),
                window,
                cx,
            )
        });
        self.time_enabled = value.time.is_some();
        if let Some(time) = value
            .time
            .as_deref()
            .and_then(|time| chrono::NaiveTime::parse_from_str(time, "%H:%M").ok())
        {
            self.time
                .update(cx, |state, cx| state.set_time(time, window, cx));
        }
        self.baseline = value;
        self.syncing = false;
        cx.notify();
    }

    pub fn set_presentation(
        &mut self,
        locale: Locale,
        disabled: bool,
        categories: Vec<String>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.locale = locale;
        self.disabled = disabled;
        self.categories = categories;
        let value = self.priority.read(cx).selected_value().copied().flatten();
        self.priority.update(cx, |select, cx| {
            select.set_items(priorities(locale, false), window, cx);
            select.set_selected_value(&value, window, cx);
        });
        cx.notify();
    }
}

impl Render for MetadataFields {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let locale = self.locale;
        let categories = self.categories.clone();
        let category = self.category.clone();
        div()
            .id("todo-metadata")
            .w_full()
            .flex()
            .flex_col()
            .gap_3()
            .min_w_0()
            .child(
                div()
                    .w_full()
                    .flex()
                    .items_start()
                    .gap_3()
                    .child(
                        div()
                            .id("task-category-column")
                            .test_support()
                            .flex_1()
                            .min_w_0()
                            .flex()
                            .flex_col()
                            .gap_2()
                            .child(text("todo.category", locale).into_owned())
                            .child(
                                Input::new(&self.category)
                                    .id("task-category")
                                    .aria_label(text("todo.category", locale).into_owned())
                                    .disabled(self.disabled)
                                    .w_full()
                                    .min_w_0()
                                    .suffix(
                                        Button::new("category-suggestions")
                                            .ghost()
                                            .small()
                                            .icon(IconName::ChevronDown)
                                            .disabled(self.disabled || categories.is_empty())
                                            .accessibility_label(
                                                text("todo.category_options", locale).into_owned(),
                                            )
                                            .dropdown_menu(move |menu, _, _| {
                                                categories.iter().fold(menu, |menu, value| {
                                                    let value = value.clone();
                                                    let category = category.clone();
                                                    menu.item(
                                                        PopupMenuItem::new(value.clone()).on_click(
                                                            move |_, window, cx| {
                                                                category.update(cx, |input, cx| {
                                                                    input.set_value(
                                                                        value.clone(),
                                                                        window,
                                                                        cx,
                                                                    )
                                                                });
                                                            },
                                                        ),
                                                    )
                                                })
                                            }),
                                    ),
                            ),
                    )
                    .child(
                        div()
                            .id("task-priority-column")
                            .test_support()
                            .flex_1()
                            .min_w_0()
                            .flex()
                            .flex_col()
                            .gap_2()
                            .child(text("todo.priority", locale).into_owned())
                            .child(
                                Select::new(&self.priority)
                                    .id("task-priority")
                                    .accessibility_label(text("todo.priority", locale).into_owned())
                                    .disabled(self.disabled)
                                    .w_full(),
                            ),
                    ),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_3()
                    .child(
                        div()
                            .w_20()
                            .flex_shrink_0()
                            .whitespace_nowrap()
                            .child(text("todo.planned", locale).into_owned()),
                    )
                    .child(
                        DatePicker::new(&self.date)
                            .placeholder(text("todo.no_date", locale).into_owned())
                            .cleanable(true)
                            .disabled(self.disabled)
                            .w_32(),
                    )
                    .child(
                        Checkbox::new("task-time-enabled")
                            .label(text("todo.specify_time", locale).into_owned())
                            .checked(self.time_enabled)
                            .disabled(self.disabled || !self.date.read(cx).date_time().is_some())
                            .on_click(cx.listener(|this, enabled, _, cx| {
                                this.time_enabled = *enabled;
                                this.changed(cx);
                            })),
                    )
                    .when(self.time_enabled, |view| {
                        view.child(TimeField::new(&self.time).disabled(self.disabled))
                    }),
            )
    }
}
