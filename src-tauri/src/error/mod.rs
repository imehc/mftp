//! Shared protocol, with Tauri-specific features selected in Cargo.

pub use mftp_foundation::{AppError, AppErrorKind, AppResult, CustomErrorCode};

pub(crate) mod persistence;

#[cfg(test)]
mod tests;

#[cfg(all(test, desktop))]
mod ipc_tests;

#[cfg(test)]
#[path = "ssh_tests.rs"]
mod ssh_tests;
