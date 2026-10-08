//! Compile-time module catalog. The command paths are collected exactly once.

#[cfg(any(desktop, target_os = "android"))]
use crate::modules::bt;
use crate::modules::{
    ai, game_room, hosts, keys, lan_transfer, maintenance, model_viewer, poetry, ssh, todo, vault,
};
use crate::{error, models};
use tauri_specta::{collect_commands, Builder};

macro_rules! collect_module_commands {
    ($([$($($command:ident)::+),* $(,)?]),* $(,)?) => {
        collect_commands![$($($($command)::+,)*)*]
    };
}

macro_rules! define_registry {
    ($($module:literal => { commands: [$($($command:ident)::+),* $(,)?], types: [$($extra:ty),* $(,)?] $(,)? }),* $(,)?) => {
        pub(crate) fn specta_builder() -> Builder<tauri::Wry> {
            let builder = Builder::<tauri::Wry>::new();
            $($(let builder = builder.typ::<$extra>();)*)*
            // tauri-specta replaces previous commands instead of appending them.
            builder.commands(collect_module_commands![$([$($($command)::+),*]),*])
        }

        #[cfg(test)]
        pub(super) fn module_commands() -> Vec<(&'static str, Vec<&'static str>)> {
            vec![$(($module, vec![$(stringify!($($command)::+)),*])),*]
        }
    };
}

macro_rules! common_modules {
    ($($platform:tt)*) => {
        define_registry! {
            "core" => { commands: [], types: [error::CustomErrorCode] },
            "model_viewer" => {
                commands: [
                    model_viewer::commands::model_viewer_open,
                    model_viewer::commands::model_viewer_attach,
                    model_viewer::commands::model_viewer_size,
                    model_viewer::commands::model_viewer_read,
                    model_viewer::commands::model_viewer_close,
                    model_viewer::library_commands::model_library_catalog,
                    model_viewer::library_commands::model_library_begin,
                    model_viewer::library_commands::model_library_write,
                    model_viewer::library_commands::model_library_commit,
                    model_viewer::library_commands::model_library_document,
                    model_viewer::library_commands::model_library_read,
                    model_viewer::library_commands::model_library_edit,
                    model_viewer::library_commands::model_library_save_view,
                    model_viewer::library_commands::model_library_delete,
                    model_viewer::library_commands::model_library_thumbnail,
                    model_viewer::library_commands::model_library_cache,
                    model_viewer::library_commands::model_library_read_thumbnail,
                ],
                types: [],
            },
            "ai" => {
                commands: [
                    ai::configuration::commands::ai_configuration_get,
                    ai::configuration::commands::ai_provider_create,
                    ai::configuration::commands::ai_provider_update,
                    ai::configuration::commands::ai_provider_delete,
                    ai::configuration::commands::ai_key_save,
                    ai::configuration::commands::ai_key_delete,
                    ai::configuration::commands::ai_model_save,
                    ai::configuration::commands::ai_model_delete,
                    ai::configuration::commands::ai_provider_activate,
                    ai::configuration::commands::ai_provider_select,
                    ai::configuration::commands::ai_model_switch,
                    ai::configuration::commands::ai_streaming_update,
                    ai::configuration::commands::ai_provider_test,
                ],
                types: [],
            },
            "hosts" => {
                commands: [
                    hosts::commands::hosts_list,
                    hosts::commands::host_get,
                    hosts::commands::host_create,
                    hosts::commands::host_update,
                    hosts::commands::host_delete,
                    hosts::commands::hosts_reorder,
                ],
                types: [],
            },
            "keys" => {
                commands: [
                    keys::commands::keys_list,
                    keys::commands::key_import,
                    keys::commands::key_delete,
                ],
                types: [],
            },
            "lan_transfer" => {
                commands: [
                    lan_transfer::commands::lan_transfer_settings,
                    lan_transfer::commands::lan_transfer_save_settings,
                    lan_transfer::commands::lan_transfer_status,
                    lan_transfer::commands::lan_transfer_network_addresses,
                    lan_transfer::commands::lan_transfer_discover_devices,
                    lan_transfer::commands::lan_transfer_connected_devices,
                    lan_transfer::commands::lan_transfer_pending_auth_requests,
                    lan_transfer::commands::lan_transfer_approve_auth_request,
                    lan_transfer::commands::lan_transfer_reject_auth_request,
                    lan_transfer::commands::lan_transfer_disconnect_device,
                    lan_transfer::commands::lan_transfer_tasks,
                    lan_transfer::commands::lan_transfer_cancel_task,
                    lan_transfer::commands::lan_transfer_start,
                    lan_transfer::commands::lan_transfer_stop,
                    lan_transfer::commands::lan_transfer_shared_dirs,
                    lan_transfer::commands::lan_transfer_add_shared_dir,
                    lan_transfer::commands::lan_transfer_delete_shared_dir,
                    lan_transfer::commands::lan_transfer_trusted_devices,
                    lan_transfer::commands::lan_transfer_add_trusted_device,
                    lan_transfer::commands::lan_transfer_delete_trusted_device,
                ],
                types: [],
            },
            "maintenance" => {
                commands: [
                    maintenance::activity::activity_logs,
                    maintenance::activity::activity_logs_clear,
                    maintenance::activity::activity_log_delete,
                ],
                types: [],
            },
            "ssh" => {
                commands: [
                    ssh::commands::ssh_connect,
                    ssh::commands::ssh_open_shell,
                    ssh::commands::ssh_write,
                    ssh::commands::ssh_resize,
                    ssh::commands::ssh_disconnect,
                    ssh::commands::ssh_system_stats,
                ],
                types: [],
            },
            "sftp" => {
                commands: [
                    ssh::commands::sftp_home,
                    ssh::commands::sftp_start_dir,
                    ssh::commands::sftp_list,
                    ssh::commands::sftp_info,
                    ssh::commands::sftp_mkdir,
                    ssh::commands::sftp_rename,
                    ssh::commands::sftp_delete,
                    ssh::commands::sftp_download,
                    ssh::commands::sftp_upload,
                    ssh::commands::sftp_exists,
                    ssh::commands::sftp_upload_dir,
                    ssh::commands::sftp_download_dir,
                    ssh::commands::sftp_cancel_transfer,
                    ssh::commands::sftp_pause_transfer,
                    ssh::commands::sftp_resume_transfer,
                    ssh::commands::sftp_reset_connection,
                    ssh::commands::sftp_extract,
                ],
                types: [models::TransferProgress],
            },
            "game_room" => {
                commands: [
                    game_room::commands::game_room_status,
                    game_room::commands::game_room_create,
                    game_room::commands::game_room_join,
                    game_room::commands::game_room_discover,
                    game_room::commands::game_room_send,
                    game_room::commands::game_room_leave,
                ],
                types: [
                    game_room::GameRoomPeerEvent,
                    game_room::GameRoomClosedEvent,
                    game_room::GameRoomMessageEvent,
                ],
            },
            "vault" => {
                commands: [
                    vault::commands::vault_entries_list,
                    vault::commands::vault_entry_create,
                    vault::commands::vault_entry_update,
                    vault::commands::vault_entry_delete,
                    vault::commands::vault_entries_reorder,
                ],
                types: [],
            },
            "todo" => {
                commands: [
                    todo::commands::todo_items_list,
                    todo::commands::todo_item_create,
                    todo::commands::todo_item_update,
                    todo::commands::todo_item_delete,
                ],
                types: [],
            },
            "export" => {
                commands: [
                    maintenance::export::data_export,
                    maintenance::export::data_inspect,
                    maintenance::export::data_import,
                ],
                types: [],
            },
            "data" => {
                commands: [
                    maintenance::data::app_data_usage,
                    maintenance::data::app_data_clear,
                    maintenance::data::app_data_reset,
                ],
                types: [],
            },
            "poetry" => {
                commands: [
                    poetry::commands::poetry_collections,
                    poetry::commands::poetry_sync_check,
                    poetry::commands::poetry_sync_start,
                    poetry::commands::poetry_sync_import_local,
                    poetry::commands::poetry_sync_cancel,
                    poetry::commands::poetry_collection_delete,
                    poetry::commands::poetry_content_index_build,
                    poetry::commands::poetry_content_index_status,
                    poetry::commands::poetry_browse,
                    poetry::commands::poetry_poem,
                    poetry::commands::poetry_search,
                    poetry::commands::poetry_authors,
                    poetry::commands::poetry_daily,
                    poetry::commands::poetry_random,
                    poetry::commands::poetry_annotations_install,
                    poetry::commands::poetry_annotations_status,
                    poetry::commands::poetry_annotations_delete,
                    poetry::commands::poetry_translation_pack_import,
                    poetry::commands::poetry_translation_packs,
                    poetry::commands::poetry_translation_pack_delete,
                    poetry::commands::list_poetry_pack_translations,
                    poetry::commands::list_poetry_translations,
                    poetry::commands::generate_poetry_translation,
                    poetry::commands::update_poetry_translation,
                    poetry::commands::delete_poetry_translation,
                ],
                types: [poetry::model::PoetrySyncProgress, poetry::model::PoetryTranslationStreamEvent],
            },
            $($platform)*
        }
    };
}

// Filter whole modules before collect_commands expands; cfg on an individual
// command entry is not supported by the pinned Tauri/Specta macro versions.
#[cfg(any(desktop, target_os = "android"))]
common_modules! {
    "bt" => {
        commands: [
            bt::commands::bt_probe,
            bt::commands::bt_add_download,
            bt::commands::bt_export,
            bt::commands::bt_list,
            bt::commands::bt_control,
            bt::commands::bt_task_peers,
            bt::commands::bt_dht_status,
            bt::commands::bt_playability,
            bt::commands::bt_browse_files,
            bt::commands::bt_preview_file,
            bt::commands::bt_open_file,
        ],
        types: [bt::BtProbeResult, bt::BtTaskInfo, bt::BtTaskStatus,
            bt::BtPackageMode, bt::BtFileMeta, bt::BtControlAction,
            bt::BtPeerInfo, bt::BtDhtStatus, bt::BtDhtState,
            bt::BtPlayability, bt::BtTaskEvent],
    },
}

#[cfg(all(mobile, not(target_os = "android")))]
common_modules! {}

#[cfg(test)]
mod tests;
