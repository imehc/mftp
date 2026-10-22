//! Local rsync argv construction and transfer-target normalization.

use super::bridge::BridgeOptions;
use crate::error::{AppError, AppResult, CustomErrorCode};
use crate::modules::ssh::RsyncDirection;
use std::ffi::{OsStr, OsString};
use std::path::Path;

pub(super) fn sync_specs(options: &BridgeOptions<'_>) -> AppResult<(OsString, OsString)> {
    let local = normalize_local(options.local_dir)?;
    let remote = normalize_remote(options.remote_dir)?;
    match options.direction {
        RsyncDirection::Upload => Ok((
            OsString::from(format!("{local}/")),
            OsString::from(format!("mftp:{remote}")),
        )),
        RsyncDirection::Download => Ok((
            OsString::from(format!("mftp:{remote}/")),
            OsString::from(local),
        )),
    }
}

pub(super) fn normalize_local(local: &str) -> AppResult<String> {
    let trimmed = local.trim().trim_end_matches('/');
    if trimmed.is_empty()
        || trimmed == "/"
        || !Path::new(trimmed).is_absolute()
        || has_control_characters(trimmed)
    {
        return Err(AppError::custom(CustomErrorCode::RsyncTargetInvalid).with_arg("path", local));
    }
    Ok(trimmed.to_string())
}

pub(super) fn normalize_remote(remote: &str) -> AppResult<String> {
    let trimmed = remote.trim().trim_end_matches('/');
    if trimmed.is_empty()
        || trimmed == "/"
        || !trimmed.starts_with('/')
        || has_control_characters(trimmed)
    {
        return Err(AppError::custom(CustomErrorCode::RsyncTargetInvalid).with_arg("path", remote));
    }
    Ok(trimmed.to_string())
}

fn has_control_characters(value: &str) -> bool {
    value.bytes().any(|byte| byte < 0x20 || byte == 0x7f)
}

pub(super) fn build_args(
    options: &BridgeOptions<'_>,
    helper: &Path,
    source: &OsStr,
    destination: &OsStr,
) -> Vec<OsString> {
    let mut args: Vec<OsString> = ["-a", "-s", "-z", "-8", "-i"]
        .into_iter()
        .map(OsString::from)
        .collect();
    if !options.dry_run {
        args.push("--info=progress2".into());
    }
    for flag in ["--no-owner", "--no-group", "--no-devices", "--no-specials"] {
        args.push(flag.into());
    }
    if options.delete_extraneous {
        args.push("--delete".into());
    }
    if options.dry_run {
        args.push("-n".into());
    }
    args.push("-e".into());
    args.push(helper.as_os_str().to_os_string());
    args.push(format!("--rsync-path={}", options.remote_rsync).into());
    args.push(source.to_os_string());
    args.push(destination.to_os_string());
    args
}

pub(super) fn direction_name(direction: RsyncDirection) -> &'static str {
    match direction {
        RsyncDirection::Upload => "upload",
        RsyncDirection::Download => "download",
    }
}

pub(super) fn display_command(path: &Path, args: &[OsString]) -> String {
    let mut display = path.display().to_string();
    for arg in args {
        display.push(' ');
        display.push_str(&arg.to_string_lossy());
    }
    display
}
