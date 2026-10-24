//! Compile-time module catalog. The command paths are collected exactly once.

#[cfg(desktop)]
pub(crate) mod mcp;

#[cfg(any(desktop, target_os = "android"))]
use crate::modules::bt;
#[cfg(desktop)]
use crate::modules::lan_transfer;
use crate::modules::{
    ai, diagnostics, filesystem, game_room, hosts, keys, maintenance, model_viewer, poetry, speech,
    ssh, todo, translation, updater, vault,
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
    ($next:ident, $($platform:tt)*) => {
        $next! {
            "core" => { commands: [], types: [error::CustomErrorCode] },
            "translation" => {
                commands: [translation::commands::translation_snapshot, translation::commands::translation_select,
                    translation::commands::translation_download, translation::commands::translation_remove,
                    translation::commands::translation_run, translation::commands::translation_cancel],
                types: [translation::model::TranslationOutput],
            },
            "speech" => {
                commands: [speech::commands::speech_catalog, speech::commands::speech_snapshot, speech::commands::speech_start, speech::commands::speech_control, speech::commands::speech_stop],
                types: [speech::model::SpeechSnapshot],
            },
            "diagnostics" => { commands: [diagnostics::diagnostics_snapshot, diagnostics::diagnostics_clear], types: [] },
            "model_viewer" => {
                commands: [
                    model_viewer::system::model_system_poll,
                    model_viewer::environment_commands::model_environment_begin,
                    model_viewer::environment_commands::model_environment_write,
                    model_viewer::environment_commands::model_environment_commit,
                    model_viewer::environment_commands::model_environment_current,
                    model_viewer::environment_commands::model_environment_read,
                    model_viewer::environment_commands::model_environment_abort,
                    model_viewer::environment_commands::model_environment_clear,
                    model_viewer::attachment_commands::model_attachment_list,
                    model_viewer::attachment_commands::model_attachment_add,
                    model_viewer::attachment_commands::model_attachment_read,
                    model_viewer::attachment_commands::model_attachment_delete,
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
                    ai::configuration::commands::ai_provider_test_streaming,
                ],
                types: [
                    ai::completion::AiStreamEvent,
                    ai::completion::AiProviderErrorCode,
                    ai::completion::AiRunOutcome,
                    ai::completion::AiTimeoutStage,
                    ai::completion::AiOutputPolicy,
                ],
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
                    ssh::commands::ssh_test_connection,
                    ssh::commands::ssh_open_shell,
                    ssh::commands::ssh_write,
                    ssh::commands::ssh_resize,
                    ssh::commands::ssh_disconnect,
                    ssh::commands::ssh_system_stats,
                ],
                types: [
                    ssh::RsyncStatus,
                    ssh::RsyncToolStatus,
                    ssh::RsyncCapabilities,
                    ssh::RsyncDirection,
                ],
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
                    todo::note_commands::todo_note_details,
                    todo::note_commands::todo_note_summaries,
                    todo::note_commands::todo_note_draft_begin,
                    todo::note_commands::todo_note_draft_close,
                    todo::note_commands::todo_note_clipboard_read,
                    todo::note_commands::todo_note_image_import,
                    todo::note_commands::todo_note_image_read,
                    todo::note_commands::todo_note_image_copy,
                    todo::note_commands::todo_note_save,
                    todo::note_commands::todo_item_set_completed,
                    todo::note_commands::todo_item_set_abandoned,
                ],
                types: [todo::events::TodoChanged],
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
                    maintenance::reset::app_data_reset_status,
                    maintenance::reset::app_data_reset_resume,
                    maintenance::reset::app_data_reset_finish,
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
                    poetry::commands::cancel_poetry_translation,
                    poetry::commands::update_poetry_translation,
                    poetry::commands::delete_poetry_translation,
                ],
                types: [poetry::model::PoetrySyncProgress, poetry::model::PoetryTranslationStreamEvent],
            },
            "filesystem" => {
                commands: [filesystem::filesystem_allow_path],
                types: [],
            },
            "updater" => {
                commands: [
                    updater::android_update_check,
                    updater::android_update_download,
                    updater::android_update_cancel,
                    updater::android_update_discard,
                    updater::android_update_install,
                    updater::android_update_open_install_settings,
                ],
                types: [
                    updater::AndroidUpdateInfo,
                    updater::AndroidUpdateDownload,
                    updater::AndroidUpdateInstall,
                    updater::AndroidUpdateProgress,
                    updater::AndroidUpdateDownloadInput,
                ],
            },
            $($platform)*
        }
    };
}

#[cfg(desktop)]
macro_rules! lan_module {
    ($next:ident, $($modules:tt)*) => {
        $next! { $($modules)*
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

        }
    };
}

#[cfg(any(desktop, target_os = "android"))]
macro_rules! bt_module {
    ($next:ident, $($modules:tt)*) => {
        $next! { $($modules)*
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
    };
}

#[cfg(any(mobile, test))]
macro_rules! mobile_export_module {
    ($next:ident, $($modules:tt)*) => {
        $next! { $($modules)*
"model_export" => { commands: [
                    model_viewer::export_commands::model_export_begin,
                    model_viewer::export_commands::model_export_write,
                    model_viewer::export_commands::model_export_present,
                    model_viewer::export_commands::model_export_cancel,
                    model_viewer::export_commands::model_export_close,
], types: [] },
        }
    };
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
macro_rules! rsync_module {
    ($next:ident, $($modules:tt)*) => {
        $next! { $($modules)*
            "rsync" => {
                commands: [
                    ssh::commands::rsync_local_status,
                    ssh::commands::rsync_capabilities,
                    ssh::commands::rsync_preview,
                    ssh::commands::rsync_transfer,
                ],
                types: [],
            },
        }
    };
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
macro_rules! add_rsync { ($($modules:tt)*) => { rsync_module!(add_mcp, $($modules)*); }; }
#[cfg(not(any(target_os = "macos", target_os = "linux")))]
macro_rules! add_rsync { ($($modules:tt)*) => { add_mcp!($($modules)*); }; }

#[cfg(desktop)]
macro_rules! mcp_module {
    ($next:ident, $($modules:tt)*) => {
        $next! { $($modules)*
            "mcp" => {
                commands: [crate::modules::mcp::commands::mcp_module_catalog,
                    crate::modules::mcp::commands::mcp_snapshot, crate::modules::mcp::commands::mcp_configure,
                    crate::modules::mcp::commands::mcp_start, crate::modules::mcp::commands::mcp_stop,
                    crate::modules::mcp::commands::mcp_credential_create, crate::modules::mcp::commands::mcp_credential_update,
                    crate::modules::mcp::commands::mcp_credential_rotate, crate::modules::mcp::commands::mcp_credential_revoke],
                types: [],
            },
        }
    };
}

#[cfg(desktop)]
macro_rules! add_mcp { ($($modules:tt)*) => { mcp_module!(add_lan, $($modules)*); }; }
#[cfg(mobile)]
macro_rules! add_mcp { ($($modules:tt)*) => { add_lan!($($modules)*); }; }

// Filter complete command groups before Specta/Tauri expand the command list.
#[cfg(desktop)]
macro_rules! add_lan { ($($modules:tt)*) => { lan_module!(add_bt, $($modules)*); }; }
#[cfg(mobile)]
macro_rules! add_lan { ($($modules:tt)*) => { add_bt!($($modules)*); }; }
#[cfg(any(desktop, target_os = "android"))]
macro_rules! add_bt { ($($modules:tt)*) => { bt_module!(add_mobile, $($modules)*); }; }
#[cfg(target_os = "ios")]
macro_rules! add_bt { ($($modules:tt)*) => { add_mobile!($($modules)*); }; }
#[cfg(mobile)]
macro_rules! add_mobile { ($($modules:tt)*) => { mobile_export_module!(define_registry, $($modules)*); }; }
#[cfg(desktop)]
macro_rules! add_mobile { ($($modules:tt)*) => { define_registry!($($modules)*); }; }

common_modules!(add_rsync,);

#[cfg(test)]
pub(crate) mod tests;
