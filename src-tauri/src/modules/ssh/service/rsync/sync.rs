//! Preview and execution of rsync directory syncs. A preview runs the real
//! dry-run, stores an operation snapshot, and execution only proceeds with the
//! matching single-use token. Target roots are checked so a symbolic link
//! cannot redirect writes or `--delete` outside the chosen directory.

use super::super::path_utils::remote_parent_of;
use super::super::types::Manager;
use super::bridge::BridgeOptions;
use super::preview::{parse_itemized, PreviewRecord, PREVIEW_ITEMS_LIMIT};
use super::spec::{normalize_local, normalize_remote};
use crate::error::{AppError, AppResult, CustomErrorCode};
use crate::modules::ssh::ports::{emit_progress, EventSink};
use crate::modules::ssh::{
    RsyncDirection, RsyncPreview, RsyncStatus, RsyncToolStatus, RsyncTransferResult,
};
use ssh2::FileStat;
use std::path::{Path, PathBuf};

impl Manager {
    pub(crate) fn rsync_preview(
        &self,
        session_id: &str,
        direction: RsyncDirection,
        local_dir: &str,
        remote_dir: &str,
        delete_extraneous: bool,
    ) -> AppResult<RsyncPreview> {
        let local_dir = normalize_local(local_dir)?;
        let remote_dir = normalize_remote(remote_dir)?;
        validate_local_target(direction, &local_dir)?;
        let (local_rsync, remote_rsync) = self.rsync_tools(session_id)?;
        self.validate_remote_target(session_id, direction, &remote_dir)?;
        let output = self.rsync_run(BridgeOptions {
            local_rsync: &local_rsync,
            remote_rsync: &remote_rsync,
            material: self.material(session_id)?,
            direction,
            local_dir: &local_dir,
            remote_dir: &remote_dir,
            delete_extraneous,
            dry_run: true,
            events: None,
            transfer_id: None,
            transfer: None,
            phase: "预览中",
        })?;
        let summary = parse_itemized(&output.stdout, PREVIEW_ITEMS_LIMIT);
        let token = self.rsync.previews.insert(PreviewRecord {
            session_id: session_id.to_string(),
            direction,
            local_dir: local_dir.clone(),
            remote_dir: remote_dir.clone(),
            delete_extraneous,
            created_at: std::time::Instant::now(),
        });
        Ok(RsyncPreview {
            token,
            direction,
            local_dir,
            remote_dir,
            delete_extraneous,
            added: summary.added,
            updated: summary.updated,
            deleted: summary.deleted,
            items: summary.items,
            truncated: summary.truncated || output.stdout_truncated,
        })
    }

    #[expect(
        clippy::too_many_arguments,
        reason = "every argument is rechecked against the stored preview snapshot"
    )]
    pub(crate) fn rsync_transfer(
        &self,
        session_id: &str,
        token: &str,
        direction: RsyncDirection,
        local_dir: &str,
        remote_dir: &str,
        delete_extraneous: bool,
        events: Option<&EventSink>,
        transfer_id: Option<&str>,
    ) -> AppResult<RsyncTransferResult> {
        let local_dir = normalize_local(local_dir)?;
        let remote_dir = normalize_remote(remote_dir)?;
        let preview = self
            .rsync
            .previews
            .take(token)
            .ok_or_else(|| AppError::custom(CustomErrorCode::RsyncPreviewExpired))?;
        if preview.session_id != session_id
            || preview.direction != direction
            || preview.local_dir != local_dir
            || preview.remote_dir != remote_dir
            || preview.delete_extraneous != delete_extraneous
        {
            return Err(AppError::custom(CustomErrorCode::RsyncPreviewMismatch));
        }

        validate_local_target(direction, &local_dir)?;
        let (local_rsync, remote_rsync) = self.rsync_tools(session_id)?;
        self.validate_remote_target(session_id, direction, &remote_dir)?;
        let material = self.material(session_id)?;
        let transfer = self.transfer_guard(transfer_id);
        if let Some(transfer) = &transfer {
            transfer.enter_unpausable()?;
        }
        emit_progress(events, transfer_id, "同步中", 0, None);
        let output = self.rsync_run(BridgeOptions {
            local_rsync: &local_rsync,
            remote_rsync: &remote_rsync,
            material,
            direction,
            local_dir: &local_dir,
            remote_dir: &remote_dir,
            delete_extraneous,
            dry_run: false,
            events,
            transfer_id,
            transfer: transfer.as_ref(),
            phase: "同步中",
        })?;
        let summary = parse_itemized(&output.stdout, 0);
        let changed_items = summary
            .added
            .saturating_add(summary.updated)
            .saturating_add(summary.deleted);
        emit_progress(events, transfer_id, "完成", output.transferred_bytes, None);
        Ok(RsyncTransferResult {
            exit_code: output.exit_code,
            transferred_bytes: output.transferred_bytes,
            network_bytes: output.network_bytes,
            changed_items,
        })
    }

    fn rsync_tools(&self, session_id: &str) -> AppResult<(PathBuf, String)> {
        let capabilities = self.rsync_capabilities(session_id, false)?;
        let local = required_tool(&capabilities.local, true)?;
        let remote = required_tool(&capabilities.remote, false)?;
        let remote = remote
            .to_str()
            .ok_or_else(|| probe_error(false, "the remote rsync path is not UTF-8"))?;
        Ok((local, remote.to_string()))
    }

    fn validate_remote_target(
        &self,
        session_id: &str,
        direction: RsyncDirection,
        remote_dir: &str,
    ) -> AppResult<()> {
        let conn = self.sftp_conn(session_id)?;
        let conn = conn.lock();
        match direction {
            RsyncDirection::Upload => match conn.sftp.lstat(Path::new(remote_dir)) {
                Ok(stat) => check_remote_target(remote_dir, &stat),
                Err(error) if is_missing(&error) => {
                    let parent = remote_parent_of(remote_dir);
                    match conn.sftp.stat(Path::new(&parent)) {
                        Ok(stat) if stat.is_dir() => Ok(()),
                        Ok(_) => Err(target_invalid(
                            remote_dir,
                            "the remote parent exists and is not a directory",
                        )),
                        Err(error) if is_missing(&error) => Err(target_invalid(
                            remote_dir,
                            "the remote parent directory does not exist",
                        )),
                        Err(error) => Err(error.into()),
                    }
                }
                Err(error) => Err(error.into()),
            },
            RsyncDirection::Download => match conn.sftp.stat(Path::new(remote_dir)) {
                Ok(stat) if stat.is_dir() => Ok(()),
                Ok(_) => Err(target_invalid(
                    remote_dir,
                    "the remote source is not a directory",
                )),
                Err(error) if is_missing(&error) => Err(target_invalid(
                    remote_dir,
                    "the remote source directory does not exist",
                )),
                Err(error) => Err(error.into()),
            },
        }
    }
}

fn required_tool(status: &RsyncToolStatus, local: bool) -> AppResult<PathBuf> {
    match status.status {
        RsyncStatus::Available => status
            .path
            .as_ref()
            .map(PathBuf::from)
            .ok_or_else(|| probe_error(local, "the probe reported no executable path")),
        RsyncStatus::Missing => Err(AppError::custom(if local {
            CustomErrorCode::RsyncLocalMissing
        } else {
            CustomErrorCode::RsyncRemoteMissing
        })),
        RsyncStatus::Unsupported => {
            let code = if local {
                CustomErrorCode::RsyncLocalUnsupported
            } else {
                CustomErrorCode::RsyncRemoteUnsupported
            };
            let mut error = AppError::custom(code);
            if let Some(detail) = status.message.as_deref() {
                error = error.with_arg("detail", detail);
            }
            Err(error)
        }
        RsyncStatus::Failed => Err(probe_error(
            local,
            status.message.as_deref().unwrap_or("probe failed"),
        )),
        RsyncStatus::Timeout => Err(probe_timeout(local)),
    }
}

fn probe_error(local: bool, detail: &str) -> AppError {
    AppError::custom(CustomErrorCode::RsyncProbeFailed)
        .with_arg("side", if local { "local" } else { "remote" })
        .with_arg("detail", detail)
}

fn probe_timeout(local: bool) -> AppError {
    AppError::custom(CustomErrorCode::RsyncProbeTimeout)
        .with_arg("side", if local { "local" } else { "remote" })
}

fn validate_local_target(direction: RsyncDirection, local_dir: &str) -> AppResult<()> {
    let path = Path::new(local_dir);
    match direction {
        RsyncDirection::Upload => {
            let metadata = std::fs::metadata(path)
                .map_err(|error| target_invalid(local_dir, error.to_string()))?;
            if !metadata.is_dir() {
                return Err(target_invalid(
                    local_dir,
                    "the local source is not a directory",
                ));
            }
            Ok(())
        }
        RsyncDirection::Download => match std::fs::symlink_metadata(path) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() {
                    return Err(target_invalid(
                        local_dir,
                        "the local target is a symbolic link",
                    ));
                }
                if !metadata.is_dir() {
                    return Err(target_invalid(
                        local_dir,
                        "the local target is not a directory",
                    ));
                }
                Ok(())
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let Some(parent) = path.parent() else {
                    return Err(target_invalid(local_dir, "the local target has no parent"));
                };
                let metadata = std::fs::metadata(parent)
                    .map_err(|error| target_invalid(local_dir, error.to_string()))?;
                if !metadata.is_dir() {
                    return Err(target_invalid(
                        local_dir,
                        "the local parent is not a directory",
                    ));
                }
                Ok(())
            }
            Err(error) => Err(AppError::from(error)
                .context("Inspecting the local rsync target")
                .with_arg("path", local_dir)),
        },
    }
}

fn check_remote_target(remote_dir: &str, stat: &FileStat) -> AppResult<()> {
    if stat.file_type().is_symlink() {
        return Err(target_invalid(
            remote_dir,
            "the remote target is a symbolic link",
        ));
    }
    if !stat.is_dir() {
        return Err(target_invalid(
            remote_dir,
            "the remote target is not a directory",
        ));
    }
    Ok(())
}

fn is_missing(error: &ssh2::Error) -> bool {
    matches!(error.code(), ssh2::ErrorCode::SFTP(2 | 10))
}

fn target_invalid(path: &str, detail: impl ToString) -> AppError {
    AppError::custom(CustomErrorCode::RsyncTargetInvalid)
        .with_arg("path", path)
        .with_arg("detail", detail)
}

#[cfg(test)]
#[path = "sync_tests.rs"]
mod tests;
