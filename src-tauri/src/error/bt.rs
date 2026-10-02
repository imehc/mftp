//! The engine's anyhow chain may retain typed IO/application failures. Its
//! string-only statistics can contain tracker URLs, so never persist those raw.

use super::AppError;

impl AppError {
    pub(crate) fn bt_engine(error: anyhow::Error) -> Self {
        for source in error.chain() {
            if let Some(error) = source.downcast_ref::<AppError>() {
                return error.clone();
            }
            if let Some(error) = source.downcast_ref::<std::io::Error>() {
                return Self::from_io(error);
            }
        }
        Self::external("bt:engine", "BT engine operation failed")
    }

    pub(crate) fn bt_engine_state() -> Self {
        Self::external("bt:engine", "BT engine reported a task failure")
    }
}

#[cfg(test)]
#[path = "bt_tests.rs"]
mod tests;
