mod commands;
mod error;
mod game_room;
mod lan_transfer;
mod models;
mod ssh;
mod storage;

use game_room::GameRoomManager;
use lan_transfer::LanTransferManager;
use ssh::Manager;
use std::fs;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime};
use storage::Storage;
#[cfg(all(debug_assertions, desktop))]
use specta_typescript::Typescript;
use tauri::Emitter as _;
use tauri::Manager as _;
use tauri_specta::{collect_commands, Builder};

/// Shared application state available to all commands.
pub struct AppState {
    pub storage: Storage,
    pub manager: Arc<Manager>,
    pub lan_transfer: Arc<LanTransferManager>,
    pub game_room: Arc<GameRoomManager>,
}

fn specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new()
        .typ::<models::TransferProgress>()
        .commands(collect_commands![
            commands::hosts_list,
            commands::host_get,
            commands::host_create,
            commands::host_update,
            commands::host_delete,
            commands::hosts_reorder,
            commands::keys_list,
            commands::key_import,
            commands::key_delete,
            commands::lan_transfer_settings,
            commands::lan_transfer_save_settings,
            commands::lan_transfer_status,
            commands::lan_transfer_network_addresses,
            commands::lan_transfer_discover_devices,
            commands::lan_transfer_connected_devices,
            commands::lan_transfer_pending_auth_requests,
            commands::lan_transfer_approve_auth_request,
            commands::lan_transfer_reject_auth_request,
            commands::lan_transfer_disconnect_device,
            commands::lan_transfer_tasks,
            commands::lan_transfer_cancel_task,
            commands::lan_transfer_start,
            commands::lan_transfer_stop,
            commands::lan_transfer_shared_dirs,
            commands::lan_transfer_add_shared_dir,
            commands::lan_transfer_delete_shared_dir,
            commands::lan_transfer_trusted_devices,
            commands::lan_transfer_add_trusted_device,
            commands::lan_transfer_delete_trusted_device,
            commands::activity_logs,
            commands::activity_logs_clear,
            commands::activity_log_delete,
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
            commands::game_room_status,
            commands::game_room_create,
            commands::game_room_join,
            commands::game_room_discover,
            commands::game_room_send,
            commands::game_room_leave,
            commands::vault_entries_list,
            commands::vault_entry_create,
            commands::vault_entry_update,
            commands::vault_entry_delete,
            commands::data_export,
            commands::data_inspect,
            commands::data_import,
        ])
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
    let specta_builder = specta_builder();

    // Exporting bindings writes into the source tree, which only exists on
    // the dev machine — running it on mobile panics at startup.
    #[cfg(all(debug_assertions, desktop))]
    specta_builder
        .export(Typescript::default(), "../src/bindings.ts")
        .expect("failed to export TypeScript bindings");

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init());

    #[cfg(desktop)]
    let app = app
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_updater::Builder::new().build());

    let app = app
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let temp_journal = data_dir.join("transfer-temp-files.json");
            let storage = Storage::new(data_dir).map_err(|e| e.to_string())?;
            let manager = Manager::new(temp_journal);
            let lan_transfer = Arc::new(LanTransferManager::new());
            // Forward room events to the webview; payloads stay opaque.
            let game_room = {
                let handle = app.handle().clone();
                Arc::new(GameRoomManager::new(Arc::new(move |event| {
                    use game_room::RoomEvent;
                    let _ = match event {
                        RoomEvent::PeerJoined { name } => handle.emit(
                            "game-room://peer",
                            serde_json::json!({ "connected": true, "name": name }),
                        ),
                        RoomEvent::PeerLeft => handle.emit(
                            "game-room://peer",
                            serde_json::json!({ "connected": false, "name": null }),
                        ),
                        RoomEvent::Message { payload } => {
                            handle.emit("game-room://message", payload)
                        }
                        RoomEvent::Closed { reason } => handle.emit(
                            "game-room://closed",
                            serde_json::json!({ "reason": reason }),
                        ),
                    };
                })))
            };
            // LAN transfer is a desktop-only feature; auto-starting its
            // server on mobile would open sockets at launch and trigger
            // network-permission prompts (iOS local network) for a feature
            // the mobile UI doesn't expose.
            #[cfg(desktop)]
            if let Ok(settings) = storage.lan_transfer_settings() {
                if settings.auto_start {
                    let shares = storage.list_lan_shared_dirs().unwrap_or_default();
                    let trusted_ips = storage
                        .list_lan_trusted_devices()
                        .unwrap_or_default()
                        .into_iter()
                        .map(|device| device.ip)
                        .collect();
                    if let Err(error) = lan_transfer.start(
                        settings,
                        shares,
                        trusted_ips,
                        storage.db_path().to_path_buf(),
                    ) {
                        eprintln!("failed to auto start LAN transfer: {error}");
                    }
                }
            }
            app.manage(AppState {
                storage,
                manager: Arc::new(manager),
                lan_transfer,
                game_room,
            });
            Ok(())
        })
        .invoke_handler(specta_builder.invoke_handler())
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
            state.lan_transfer.stop();
            state.game_room.leave();
        }
        cleanup_stale_local_transfer_files();
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_typescript_bindings() {
        specta_builder()
            .export(Typescript::default(), "../src/bindings.ts")
            .expect("failed to export TypeScript bindings");
    }
}
