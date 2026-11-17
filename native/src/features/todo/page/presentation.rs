//! Dates and summaries are derived from persisted task semantics, never guessed closure times.
use crate::i18n::{Locale, text};
use chrono::{Local, TimeZone};
use mftp_todo::model::TodoItem;

pub(super) fn timestamp(value: i64, locale: Locale) -> String {
    Local
        .timestamp_millis_opt(value)
        .single()
        .map(|date| {
            date.format(if locale == Locale::Chinese {
                "%Y/%m/%d %H:%M"
            } else {
                "%m/%d/%Y %H:%M"
            })
            .to_string()
        })
        .unwrap_or_else(|| text("todo.untracked", locale).into_owned())
}

pub(super) fn row_summary(item: &TodoItem, locale: Locale, image_count: usize) -> String {
    let mut parts = Vec::new();
    if let Some(time) = mftp_todo::closure_time(item).or(item.due_at) {
        parts.push(timestamp(time, locale));
    } else if let Some(date) = &item.due_date {
        parts.push(date.clone());
    }
    if let Some(notes) = &item.notes {
        parts.push(
            notes
                .lines()
                .next()
                .unwrap_or("")
                .chars()
                .take(100)
                .collect(),
        );
    }
    if image_count > 0 {
        parts.push(image_count_label(image_count, locale));
    }
    parts.join(" · ")
}

pub(super) fn image_count_label(count: usize, locale: Locale) -> String {
    if count == 1 {
        text("todo.image_count_one", locale).into_owned()
    } else {
        rust_i18n::t!("todo.image_count", locale = locale.as_str(), count = count).into_owned()
    }
}
