//! Complete editor fields are persisted as local input plus the last validated instant.
use chrono::{Local, TimeZone};
use mftp_foundation::{AppError, AppResult, CustomErrorCode};
use mftp_todo::model::{TodoItem, TodoPriority};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Metadata {
    pub category: String,
    pub priority: Option<TodoPriority>,
    pub date: Option<String>,
    pub time: Option<String>,
    pub instant: Option<i64>,
}

impl Metadata {
    pub fn from_item(item: &TodoItem) -> Self {
        let local = item
            .due_at
            .and_then(|time| Local.timestamp_millis_opt(time).single());
        Self {
            category: item.category.clone().unwrap_or_default(),
            priority: item.priority,
            date: local
                .map(|value| value.format("%Y-%m-%d").to_string())
                .or_else(|| item.due_date.clone()),
            time: local.map(|value| value.format("%H:%M").to_string()),
            instant: item.due_at,
        }
    }

    pub fn validate(&self) -> AppResult<Option<i64>> {
        let Some(time) = &self.time else {
            return Ok(None);
        };
        let date = self.date.as_deref().ok_or_else(invalid_time)?;
        if let Some(instant) = self.instant {
            let old = Local.timestamp_millis_opt(instant).single();
            if old.is_some_and(|old| {
                old.format("%Y-%m-%d").to_string() == date
                    && old.format("%H:%M").to_string() == *time
            }) {
                return Ok(Some(instant));
            }
        }
        let naive =
            chrono::NaiveDateTime::parse_from_str(&format!("{date} {time}"), "%Y-%m-%d %H:%M")
                .map_err(|_| invalid_time())?;
        if naive.format("%Y-%m-%d %H:%M").to_string() != format!("{date} {time}") {
            return Err(invalid_time());
        }
        // Match JavaScript Date's earlier instant for repeated DST hours; skipped hours are rejected.
        let value = Local
            .from_local_datetime(&naive)
            .earliest()
            .ok_or_else(invalid_time)?
            .timestamp_millis();
        if !(0..=253_402_300_799_999).contains(&value) {
            return Err(invalid_time());
        }
        Ok(Some(value))
    }
}

fn invalid_time() -> AppError {
    AppError::custom(CustomErrorCode::TodoDueTimeInvalid)
}
