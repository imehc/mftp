use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use specta::Type;

#[cfg(any(desktop, target_os = "android"))]
mod bt;
mod codes;
mod external;
mod ssh;
// The shared activity log store persists structured errors on every platform
// (the Executor logging path exists in mobile builds too), so the versioned
// envelope is unconditional; BT task errors reuse the same codec.
pub(crate) mod persistence;

pub use codes::CustomErrorCode;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum AppErrorKind {
    Custom,
    External,
}

/// Both kinds use the same wire shape, including an empty args object.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
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

    pub(crate) fn external(code: &'static str, message: impl Into<String>) -> Self {
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

#[cfg(test)]
mod tests;

#[cfg(all(test, desktop))]
mod ipc_tests;
