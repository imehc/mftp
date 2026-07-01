mod commands;
mod error;
mod models;
mod ssh;
mod storage;

use ssh::Manager;
use std::sync::Arc;
use storage::Storage;
use tauri::Manager as _;

/// Shared application state available to all commands.
pub struct AppState {
    pub storage: Storage,
    pub manager: Arc<Manager>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let storage = Storage::new(data_dir).map_err(|e| e.to_string())?;
            app.manage(AppState {
                storage,
                manager: Arc::new(Manager::default()),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::hosts_list,
            commands::host_get,
            commands::host_create,
            commands::host_update,
            commands::host_delete,
            commands::keys_list,
            commands::key_import,
            commands::key_delete,
            commands::ssh_connect,
            commands::ssh_open_shell,
            commands::ssh_write,
            commands::ssh_resize,
            commands::ssh_disconnect,
            commands::sftp_home,
            commands::sftp_start_dir,
            commands::sftp_list,
            commands::sftp_mkdir,
            commands::sftp_rename,
            commands::sftp_delete,
            commands::sftp_download,
            commands::sftp_upload,
            commands::sftp_exists,
            commands::sftp_upload_dir,
            commands::sftp_download_dir,
            commands::sftp_cancel_transfer,
            commands::sftp_extract,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
