use super::AppError;

impl From<tauri::Error> for AppError {
    fn from(error: tauri::Error) -> Self {
        match error {
            tauri::Error::Io(error) => error.into(),
            tauri::Error::Json(error) => error.into(),
            tauri::Error::JoinError(error) if error.is_cancelled() => {
                Self::external("task:cancelled", "Background task was cancelled")
            }
            // Panic payloads can contain secrets. The runtime owns diagnostic logs.
            tauri::Error::JoinError(_) => {
                Self::external("task:panicked", "Background task panicked")
            }
            _ => Self::external("runtime:operation", "Runtime operation failed"),
        }
    }
}

impl From<tauri_plugin_opener::Error> for AppError {
    fn from(error: tauri_plugin_opener::Error) -> Self {
        match error {
            tauri_plugin_opener::Error::Io(error) => error.into(),
            tauri_plugin_opener::Error::Json(error) => error.into(),
            tauri_plugin_opener::Error::Tauri(error) => error.into(),
            error => Self::external("opener:open", error.to_string()),
        }
    }
}
