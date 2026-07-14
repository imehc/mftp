mod commands;
mod error;
mod models;
mod ssh;
mod storage;

use ssh::Manager;
use std::fs;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime};
use storage::Storage;
use tauri::Manager as _;

/// Shared application state available to all commands.
pub struct AppState {
    pub storage: Storage,
    pub manager: Arc<Manager>,
}

fn cleanup_stale_local_transfer_files() {
    let Ok(entries) = fs::read_dir(std::env::temp_dir()) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let is_transfer_archive = (name.starts_with("mftp-up-") || name.starts_with("mftp-dl-"))
            && name.ends_with(".tar.gz");
        let is_stale = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(|modified| SystemTime::now().duration_since(modified).ok())
            .is_some_and(|age| age >= Duration::from_secs(24 * 60 * 60));
        if is_transfer_archive && is_stale {
            let _ = fs::remove_file(entry.path());
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    cleanup_stale_local_transfer_files();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let temp_journal = data_dir.join("transfer-temp-files.json");
            let storage = Storage::new(data_dir).map_err(|e| e.to_string())?;
            let manager = Manager::new(temp_journal);
            app.manage(AppState {
                storage,
                manager: Arc::new(manager),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::hosts_list,
            commands::host_get,
            commands::host_create,
            commands::host_update,
            commands::host_delete,
            commands::hosts_reorder,
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
            commands::sftp_info,
            commands::sftp_mkdir,
            commands::sftp_rename,
            commands::sftp_delete,
            commands::sftp_download,
            commands::sftp_upload,
            commands::sftp_exists,
            commands::sftp_upload_dir,
            commands::sftp_download_dir,
            commands::sftp_cancel_transfer,
            commands::sftp_pause_transfer,
            commands::sftp_resume_transfer,
            commands::sftp_reset_connection,
            commands::sftp_extract,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    let cleaned_up = Arc::new(AtomicBool::new(false));
    app.run(move |app_handle, event| {
        if !matches!(
            event,
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
        ) || cleaned_up.swap(true, Ordering::SeqCst)
        {
            return;
        }
        if let Some(state) = app_handle.try_state::<AppState>() {
            state.manager.shutdown_all();
        }
        cleanup_stale_local_transfer_files();
    });
}
