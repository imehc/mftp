//! Read-only local transcript discovery, usage and retrieval, available on macOS.
mod codebuddy;
pub(crate) mod commands;
mod database;
mod discovery;
mod images;
mod input;
mod json;
pub(crate) mod model;
mod opencode;
mod parser;
mod qoder;
mod qoder_desktop;
mod reader;
mod revision;
mod service;
mod sqlite_snapshot;
mod storage;
mod storage_service;
mod text;
mod transcript;
mod vscode;

pub(crate) use service::AgentSessionService;

#[cfg(test)]
mod storage_service_tests;

#[cfg(test)]
mod codebuddy_tests;
#[cfg(test)]
mod expansion_tests;
#[cfg(test)]
mod tests;

#[cfg(test)]
mod compression_session_tests;
#[cfg(test)]
mod database_tests;
#[cfg(test)]
mod input_tests;
#[cfg(test)]
mod sqlite_snapshot_tests;
#[cfg(test)]
mod vscode_tests;
