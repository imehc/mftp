use super::AppError;

impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        Self::from_io(&error)
    }
}

impl AppError {
    pub(crate) fn from_io(error: &std::io::Error) -> Self {
        // IO-based libraries may wrap an application error as a source. Restore
        // its payload before classifying IO, including through nested wrappers.
        let mut source = error
            .get_ref()
            .map(|source| source as &dyn std::error::Error);
        // Bound traversal because third-party Error implementations can cycle.
        for _ in 0..32 {
            let Some(current) = source else { break };
            if let Some(app_error) = current.downcast_ref::<AppError>() {
                return app_error.clone();
            }
            if let Some(ssh_error) = current.downcast_ref::<ssh2::Error>() {
                return Self::from_ssh(ssh_error);
            }
            source = if let Some(io_error) = current.downcast_ref::<std::io::Error>() {
                // io::Error::source skips its immediate payload on some wrappers.
                io_error
                    .get_ref()
                    .map(|source| source as &dyn std::error::Error)
            } else {
                current.source()
            };
        }
        use std::io::ErrorKind;
        let code = match error.kind() {
            ErrorKind::NotFound => "io:not_found",
            ErrorKind::PermissionDenied => "io:permission_denied",
            ErrorKind::TimedOut => "io:timed_out",
            ErrorKind::ConnectionReset => "io:connection_reset",
            ErrorKind::ConnectionAborted => "io:connection_aborted",
            ErrorKind::ConnectionRefused => "io:connection_refused",
            ErrorKind::NotConnected => "io:not_connected",
            ErrorKind::BrokenPipe => "io:broken_pipe",
            ErrorKind::WouldBlock => "io:would_block",
            ErrorKind::Interrupted => "io:interrupted",
            ErrorKind::UnexpectedEof => "io:unexpected_eof",
            ErrorKind::WriteZero => "io:write_zero",
            ErrorKind::AlreadyExists => "io:already_exists",
            ErrorKind::InvalidInput => "io:invalid_input",
            ErrorKind::InvalidData => "io:invalid_data",
            _ => "io:other",
        };
        let mut converted = Self::external(code, error.to_string());
        if let Some(os_code) = error.raw_os_error() {
            converted = converted.with_arg("osCode", os_code);
        }
        converted
    }
}

impl From<walkdir::Error> for AppError {
    fn from(error: walkdir::Error) -> Self {
        let converted = match error.io_error() {
            Some(io) => Self::from_io(io),
            None => Self::external("fs:walk", "Directory traversal failed"),
        };
        match error.path() {
            Some(path) => converted.with_arg("path", path.display()),
            None => converted,
        }
    }
}

impl From<serde_json::Error> for AppError {
    fn from(error: serde_json::Error) -> Self {
        // Deserializer diagnostics can echo untrusted values. Keep location and
        // category, never a deserialized token or a provider response body.
        let (code, message) = match error.classify() {
            serde_json::error::Category::Io => ("json:io", "JSON input/output failed"),
            serde_json::error::Category::Syntax => ("json:parse", "Invalid JSON syntax"),
            serde_json::error::Category::Data => ("json:data", "Invalid JSON value"),
            serde_json::error::Category::Eof => ("json:eof", "Unexpected end of JSON input"),
        };
        Self::external(code, message)
            .with_arg("line", error.line())
            .with_arg("column", error.column())
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(error: rusqlite::Error) -> Self {
        // Row mappers wrap already-classified domain errors in
        // ToSqlConversionFailure; restore the payload instead of flattening it
        // into the generic database diagnostic below.
        if let rusqlite::Error::ToSqlConversionFailure(inner) = &error {
            if let Some(app_error) = inner.downcast_ref::<AppError>() {
                return app_error.clone();
            }
        }
        // SQLite diagnostics may embed SQL or values; retain numeric diagnostics.
        match error {
            rusqlite::Error::SqliteFailure(inner, _) => {
                Self::external("db:sqlite", inner.to_string())
                    .with_arg("sourceCode", inner.extended_code)
            }
            rusqlite::Error::QueryReturnedNoRows => {
                Self::external("db:no_rows", "Database query returned no rows")
            }
            _ => Self::external("db:operation", "Database operation failed"),
        }
    }
}

impl From<reqwest::Error> for AppError {
    fn from(error: reqwest::Error) -> Self {
        // Even source chains can contain credentials and query tokens. Do not
        // forward Display/body/URL; expose safe HTTP diagnostics only.
        let (code, message) = if error.is_timeout() {
            ("http:timed_out", "HTTP request timed out")
        } else if error.is_connect() {
            ("http:connect", "HTTP connection failed")
        } else if error.is_status() {
            (
                "http:status",
                "HTTP request returned an unsuccessful status",
            )
        } else if error.is_decode() {
            ("http:decode", "HTTP response could not be decoded")
        } else if error.is_builder() {
            ("http:invalid_request", "HTTP request could not be built")
        } else {
            ("http:request", "HTTP request failed")
        };
        let mut converted = Self::external(code, message);
        if let Some(status) = error.status() {
            converted = converted.with_arg("status", status.as_u16());
        }
        converted
    }
}

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
