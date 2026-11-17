//! Shared structured diagnostics and optional platform conversions.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
#[cfg(feature = "specta")]
use specta::Type;

mod codes;
mod external;
#[cfg(feature = "sqlite")]
pub mod sqlite;
#[cfg(feature = "ssh")]
mod ssh;
#[cfg(feature = "tauri")]
mod tauri;
pub mod time;
pub use codes::CustomErrorCode;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(Type))]
#[serde(rename_all = "camelCase")]
pub enum AppErrorKind {
    Custom,
    External,
}

/// Both kinds use the same wire shape, including an empty args object.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(Type))]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub kind: AppErrorKind,
    pub code: String,
    pub message: String,
    pub args: BTreeMap<String, String>,
}

impl AppError {
    pub fn custom(code: CustomErrorCode) -> Self {
        Self {
            kind: AppErrorKind::Custom,
            code: code.as_str().into(),
            message: code.message().into(),
            args: BTreeMap::new(),
        }
    }

    pub fn external(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            kind: AppErrorKind::External,
            code: code.into(),
            message: message.into(),
            args: BTreeMap::new(),
        }
    }

    pub fn with_arg(mut self, name: &str, value: impl ToString) -> Self {
        self.args.insert(name.into(), value.to_string());
        self
    }

    pub fn context(mut self, context: impl std::fmt::Display) -> Self {
        self.message = format!("{context}: {}", self.message);
        self
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for AppError {}

pub type AppResult<T> = Result<T, AppError>;
