//! Local helper handshake. The helper is rsync's remote-shell program, so it
//! must prove which task directory it belongs to and hand its remote argv to
//! the app before any SSH channel is opened.

use super::super::path_utils::shell_quote;
use crate::error::{AppError, AppResult, CustomErrorCode};
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

pub(super) const HELPER_NAME: &str = "mftp-rsync-bridge";
pub(super) const TOKEN_FILE: &str = "token";
pub(super) const SOCKET_FILE: &str = "bridge.sock";
pub(super) const TASK_PREFIX: &str = "mftp-rsync-";
pub(super) const HANDSHAKE_LIMIT: usize = 64 * 1024;
pub(super) const FLAG_GROUP_LIMIT: usize = 64;

#[derive(Debug, Serialize, Deserialize)]
pub(super) struct HelperHandshake {
    pub(super) token: String,
    pub(super) argv: Vec<String>,
}

pub(super) fn write_frame(writer: &mut impl Write, payload: &[u8]) -> std::io::Result<()> {
    let length = u32::try_from(payload.len())
        .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidInput, "frame too large"))?;
    writer.write_all(&length.to_be_bytes())?;
    writer.write_all(payload)?;
    writer.flush()
}

pub(super) fn read_frame(reader: &mut impl Read, limit: usize) -> std::io::Result<Vec<u8>> {
    let mut header = [0u8; 4];
    reader.read_exact(&mut header)?;
    let length = u32::from_be_bytes(header) as usize;
    if length > limit {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "handshake exceeds the size limit",
        ));
    }
    let mut payload = vec![0u8; length];
    reader.read_exact(&mut payload)?;
    Ok(payload)
}

pub(super) fn encode_handshake(handshake: &HelperHandshake) -> std::io::Result<Vec<u8>> {
    serde_json::to_vec(handshake).map_err(std::io::Error::other)
}

pub(super) fn decode_handshake(payload: &[u8]) -> std::io::Result<HelperHandshake> {
    serde_json::from_slice(payload).map_err(std::io::Error::other)
}

/// Accept only the exact server form rsync produces with `-s`:
/// `rsync --server [--sender] -s<flags>`. Paths travel over the protocol, so no
/// other argument may appear here.
pub(super) fn validate_remote_command(
    argv: &[String],
    expected_program: &str,
    direction: crate::modules::ssh::RsyncDirection,
) -> AppResult<()> {
    let [program, server, rest @ ..] = argv else {
        return Err(rejected("missing remote command"));
    };
    if program != expected_program {
        return Err(rejected("remote rsync path does not match the probed path"));
    }
    if server != "--server" {
        return Err(rejected("remote command is not rsync server mode"));
    }
    let (sender, flags) = match rest {
        [flags] => (false, flags),
        [sender, flags] if sender == "--sender" => (true, flags),
        _ => return Err(rejected("unexpected rsync server arguments")),
    };
    let expects_sender = matches!(direction, crate::modules::ssh::RsyncDirection::Download);
    if sender != expects_sender {
        return Err(rejected("rsync server direction does not match the task"));
    }
    if !is_valid_flag_group(flags) {
        return Err(rejected("rsync server flags were not protected"));
    }
    Ok(())
}

fn is_valid_flag_group(flags: &str) -> bool {
    let Some(rest) = flags.strip_prefix("-s") else {
        return false;
    };
    !rest.is_empty()
        && flags.len() <= FLAG_GROUP_LIMIT
        && rest.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'+' | b'_' | b',')
        })
}

/// The remote executable comes from our probe, but it still crosses a shell
/// boundary. Keep it to a conservative absolute-path alphabet.
pub(super) fn is_safe_remote_program(program: &str) -> bool {
    program.starts_with('/')
        && program.len() <= 1024
        && program.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'.' | b'_' | b'-' | b'+' | b'@')
        })
}

pub(super) fn remote_command_line(program: &str, argv: &[String]) -> String {
    let mut line = shell_quote(program);
    for arg in argv {
        line.push(' ');
        line.push_str(&shell_quote(arg));
    }
    line
}

pub(super) fn is_helper_path(program: &Path) -> bool {
    if program.file_name().and_then(|name| name.to_str()) != Some(HELPER_NAME) {
        return false;
    }
    let Some(directory) = program.parent() else {
        return false;
    };
    let Some(name) = directory.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    if !name.starts_with(TASK_PREFIX) || !directory.join(TOKEN_FILE).is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(metadata) = std::fs::metadata(directory) {
            if metadata.permissions().mode() & 0o077 != 0 {
                return false;
            }
        }
    }
    true
}

pub(super) fn helper_task_dir(program: &Path) -> Option<PathBuf> {
    if !is_helper_path(program) {
        return None;
    }
    program.parent().map(Path::to_path_buf)
}

fn rejected(reason: &'static str) -> AppError {
    AppError::custom(CustomErrorCode::RsyncRemoteCommandRejected).with_arg("reason", reason)
}

#[cfg(test)]
#[path = "protocol_tests.rs"]
mod tests;
