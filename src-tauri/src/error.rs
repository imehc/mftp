use serde::Serialize;
use specta::Type;

/// Unified error type surfaced to the frontend as a plain string.
#[derive(Debug, Type)]
pub struct AppError(pub String);

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for AppError {}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.0)
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError(e.to_string())
    }
}

impl From<ssh2::Error> for AppError {
    fn from(e: ssh2::Error) -> Self {
        AppError(e.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError(e.to_string())
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError(e.to_string())
    }
}

impl From<String> for AppError {
    fn from(e: String) -> Self {
        AppError(e)
    }
}

impl From<&str> for AppError {
    fn from(e: &str) -> Self {
        AppError(e.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
