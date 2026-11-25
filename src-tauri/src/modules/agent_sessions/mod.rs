//! Read-only local transcript discovery, usage and retrieval, available on macOS.
#[cfg(target_os = "macos")]
mod codebuddy;
pub(crate) mod commands;
#[cfg(target_os = "macos")]
mod database;
#[cfg(target_os = "macos")]
mod discovery;
#[cfg(target_os = "macos")]
mod images;
#[cfg(target_os = "macos")]
mod input;
#[cfg(target_os = "macos")]
mod json;
pub(crate) mod model;
#[cfg(target_os = "macos")]
mod opencode;
#[cfg(target_os = "macos")]
mod parser;
#[cfg(target_os = "macos")]
mod qoder;
#[cfg(target_os = "macos")]
mod qoder_desktop;
#[cfg(target_os = "macos")]
mod reader;
#[cfg(target_os = "macos")]
mod revision;
#[cfg(target_os = "macos")]
mod service;
#[cfg(target_os = "macos")]
mod sqlite_snapshot;
#[cfg(target_os = "macos")]
mod storage;
#[cfg(target_os = "macos")]
mod storage_service;
#[cfg(target_os = "macos")]
mod text;
#[cfg(target_os = "macos")]
mod transcript;
#[cfg(target_os = "macos")]
mod vscode;

#[cfg(target_os = "macos")]
pub(crate) use service::AgentSessionService;

#[cfg(all(test, target_os = "macos"))]
mod storage_service_tests;

#[cfg(all(test, target_os = "macos"))]
mod codebuddy_tests;
#[cfg(all(test, target_os = "macos"))]
mod expansion_tests;
#[cfg(all(test, target_os = "macos"))]
mod tests;

#[cfg(all(test, target_os = "macos"))]
mod compression_session_tests;
#[cfg(all(test, target_os = "macos"))]
mod database_tests;
#[cfg(all(test, target_os = "macos"))]
mod input_tests;
#[cfg(all(test, target_os = "macos"))]
mod sqlite_snapshot_tests;
#[cfg(all(test, target_os = "macos"))]
mod vscode_tests;
