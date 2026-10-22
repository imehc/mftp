//! SSH/SFTP facade. Private modules own their imports and expose only the
//! helpers used by sibling modules; application callers use this facade.

mod admission;
mod archive;
mod archive_extract;
mod auth;
mod connection_test;
mod diagnostics;
mod download_archive;
mod download_direct;
mod download_file;
mod errors;
mod extract;
mod logged_file;
mod logged_sftp;
mod manager_session;
mod monitor;
mod path_utils;
mod remote_command;
mod remote_command_io;
mod remote_ops;
mod remote_temp;
#[cfg(any(target_os = "macos", target_os = "linux"))]
mod rsync;
mod sftp_basic;
mod sftp_connection;
mod shell_lifecycle;
mod shell_worker;
mod temp_cleanup;
mod transfer_control;
mod transfer_io;
mod transfer_models;
mod transfer_retry;
mod types;
mod upload;

pub(crate) use auth::auth_method;
pub use auth::resolve_auth_material;
pub(crate) use connection_test::test_connection;
#[cfg(any(target_os = "macos", target_os = "linux"))]
pub(crate) use rsync::run_if_requested as run_rsync_helper_if_requested;
pub use types::{AuthMaterial, DirectoryTransferMode, Manager};
pub(crate) use upload::UploadDirectoryTarget;

#[cfg(test)]
mod test_support;
