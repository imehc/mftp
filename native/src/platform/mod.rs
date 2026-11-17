//! Independent application identity and data-directory selection.

use std::{ffi::OsString, fmt, path::PathBuf};

/// The native process never shares Tauri's application identifier.
pub const APP_ID: &str = "app.mftp.native";

/// Paths selected at startup; resolving them does not read or create any files.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppPaths {
    /// Root for this native application's database and preferences.
    pub data_dir: PathBuf,
}

/// Parsed process startup request.
#[derive(Debug, PartialEq, Eq)]
pub enum Startup {
    /// Print usage without initializing a graphical application.
    Help,
    /// Start a graphical application with independent data paths.
    Run(AppPaths),
}

/// Configuration failures stay structured until the process boundary.
#[derive(Debug, PartialEq, Eq)]
pub enum StartupError {
    /// An unrecognized argument was supplied.
    UnknownArgument,
    /// The data directory flag was repeated.
    DuplicateDataDirectory,
    /// No nonempty directory value was supplied.
    MissingDataDirectory,
    /// The operating system did not provide an application data directory.
    DataDirectoryUnavailable,
}

impl fmt::Display for StartupError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::UnknownArgument => "unknown argument; use --help",
            Self::DuplicateDataDirectory => "--data-dir can only be supplied once",
            Self::MissingDataDirectory => "--data-dir requires a nonempty directory",
            Self::DataDirectoryUnavailable => {
                "system data directory unavailable; supply --data-dir"
            }
        })
    }
}

impl std::error::Error for StartupError {}

impl Startup {
    /// Parse OS arguments, preserving non-Unicode paths and avoiding Tauri storage.
    pub fn from_args(args: impl IntoIterator<Item = OsString>) -> Result<Self, StartupError> {
        Self::parse(
            args,
            dirs::data_local_dir,
            std::env::var_os("MFTP_NATIVE_DATA_DIR"),
        )
    }

    fn parse(
        args: impl IntoIterator<Item = OsString>,
        system_directory: impl FnOnce() -> Option<PathBuf>,
        environment_directory: Option<OsString>,
    ) -> Result<Self, StartupError> {
        let mut args = args.into_iter();
        let mut data_dir = None;
        while let Some(argument) = args.next() {
            if argument == "--help" || argument == "-h" {
                return Ok(Self::Help);
            }
            if argument != "--data-dir" {
                return Err(StartupError::UnknownArgument);
            }
            if data_dir.is_some() {
                return Err(StartupError::DuplicateDataDirectory);
            }
            let directory = args.next().ok_or(StartupError::MissingDataDirectory)?;
            if directory.is_empty() || directory.to_string_lossy().starts_with("--") {
                return Err(StartupError::MissingDataDirectory);
            }
            data_dir = Some(PathBuf::from(directory));
        }
        let data_dir = match data_dir.or_else(|| environment_directory.map(PathBuf::from)) {
            Some(directory) => directory,
            None => system_directory()
                .ok_or(StartupError::DataDirectoryUnavailable)?
                .join(APP_ID),
        };
        if data_dir.as_os_str().is_empty() {
            return Err(StartupError::MissingDataDirectory);
        }
        Ok(Self::Run(AppPaths { data_dir }))
    }
}

#[cfg(test)]
mod tests;
