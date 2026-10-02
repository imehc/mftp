//! SSH/SFTP facade. Private modules own their imports and expose only the
//! helpers used by sibling modules; application callers use this facade.

mod admission;
mod archive;
mod archive_extract;
mod auth;
mod download_archive;
mod download_direct;
mod download_file;
mod errors;
mod extract;
mod manager_session;
mod monitor;
mod path_utils;
mod remote_command;
mod remote_command_io;
mod remote_ops;
mod remote_temp;
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

pub use auth::resolve_auth_material;
pub use types::{AuthMaterial, AuthMethod, DirectoryTransferMode, Manager};

#[cfg(test)]
mod test_support;
