// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    if mftp_lib::run_rsync_helper_if_requested() {
        return;
    }
    mftp_lib::run()
}
