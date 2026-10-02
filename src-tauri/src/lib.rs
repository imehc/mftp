mod adapters;
mod app;
mod core;
mod error;
mod file_opener;
mod models;
mod modules;
mod storage;
mod transfer;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if let Err(error) = app::run() {
        eprintln!("application startup failed: {error}");
    }
}

#[cfg(test)]
#[path = "lib_tests.rs"]
mod tests;
