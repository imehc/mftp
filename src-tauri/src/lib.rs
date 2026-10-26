mod adapters;
mod app;
mod core;
mod error;
mod file_opener;
mod models;
mod modules;
mod storage;
mod transfer;

/// rsync starts this executable as its remote shell. The branch must run
/// before Tauri init: the single-instance plugin would otherwise hand the
/// helper process to the running app instead of relaying the protocol.
#[cfg(any(target_os = "macos", target_os = "linux"))]
#[doc(hidden)]
pub fn run_rsync_helper_if_requested() -> bool {
    modules::ssh::run_rsync_helper_if_requested()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if let Err(error) = app::run() {
        crate::runtime_log!("application startup failed: {error}");
    }
}

#[cfg(test)]
#[path = "lib_tests.rs"]
mod tests;
