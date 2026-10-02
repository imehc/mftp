use super::super::ports::{emit_progress, EventSink};
use super::archive::pack_clean_tar_gz;
use super::auth::SSH_OPERATION_TIMEOUT_MS;
use super::errors::stale_app_error;
use super::path_utils::{join_remote, remote_parent_of, remote_temp_sibling, shell_quote, uuid_v4};
use super::remote_ops::remote_file_size;
use super::transfer_io::{copy_upload, seek_transfer, verify_size};
use super::transfer_models::{build_upload_plan, UploadEntryKind};
use super::transfer_retry::{run_transfer, AttemptError, SFTP_TRANSFER_RETRIES};
use super::types::{DirectoryTransferMode, Manager, TransferGuard, TransferIoOutcome};
use crate::error::{AppError, AppResult, CustomErrorCode};
use ssh2::{OpenFlags, OpenType};
use std::cell::Cell;
use std::path::Path;
use std::time::{Duration, Instant};

impl Manager {
    pub(super) fn upload_local_file_to_remote(
        &self,
        session_id: &str,
        local: &Path,
        remote: &str,
        events: Option<&EventSink>,
        transfer_id: Option<&str>,
        phase: &str,
        completed_before: u64,
        total: u64,
        transfer: Option<&TransferGuard>,
    ) -> AppResult<()> {
        let mut local_file = std::fs::File::open(local)?;
        let file_size = local_file.metadata()?.len();
        let transferred = Cell::new(0);
        let mut last_emit = Instant::now();
        run_transfer(
            transfer,
            || self.sftp_conn(session_id),
            |connection| {
                let conn = connection.lock();
                // Cached exec channels may have disabled the timeout. Restore
                // the normal bound before transfer IO so reads cannot hang forever.
                conn.session.set_timeout(SSH_OPERATION_TIMEOUT_MS);
                // A failed write may have reached the server. Resume from its
                // acknowledged file size, never from our attempted byte count.
                let size = remote_file_size(conn.sftp.stat(Path::new(remote)))
                    .map_err(AttemptError::remote)?
                    .unwrap_or(0);
                if size > file_size {
                    verify_size(size, Some(file_size), remote).map_err(AttemptError::local)?;
                }
                transferred.set(size);
                let mut remote_file = if size == 0 {
                    conn.sftp
                        .create(Path::new(remote))
                        .map_err(AttemptError::remote)?
                } else {
                    conn.sftp
                        .open_mode(Path::new(remote), OpenFlags::WRITE, 0o644, OpenType::File)
                        .map_err(AttemptError::remote)?
                };
                seek_transfer(&mut local_file, &mut remote_file, size)?;
                emit_progress(
                    events,
                    transfer_id,
                    phase,
                    completed_before + size,
                    Some(total),
                );
                let outcome = copy_upload(
                    &mut local_file,
                    &mut remote_file,
                    transfer,
                    |count| {
                        transferred.set(transferred.get() + count as u64);
                        if last_emit.elapsed() >= Duration::from_millis(120) {
                            emit_progress(
                                events,
                                transfer_id,
                                phase,
                                completed_before + transferred.get(),
                                Some(total),
                            );
                            last_emit = Instant::now();
                        }
                    },
                    || {
                        let _ = conn.session.keepalive_send();
                    },
                )?;
                remote_file.close().map_err(AttemptError::remote)?;
                if outcome == TransferIoOutcome::Complete {
                    let actual = remote_file_size(conn.sftp.stat(Path::new(remote)))
                        .map_err(AttemptError::remote)?
                        .ok_or_else(|| {
                            AttemptError::local(
                                AppError::custom(CustomErrorCode::SftpRemoteFileMissing)
                                    .with_arg("path", remote),
                            )
                        })?;
                    verify_size(actual, Some(file_size), remote).map_err(AttemptError::local)?;
                }
                Ok(outcome)
            },
            |conn| self.remove_sftp_conn_if_current(session_id, conn),
            |attempts| {
                emit_progress(
                    events,
                    transfer_id,
                    &format!("网络波动，正在续传（{attempts}/{SFTP_TRANSFER_RETRIES}）"),
                    completed_before + transferred.get(),
                    Some(total),
                )
            },
        )?;
        emit_progress(
            events,
            transfer_id,
            phase,
            completed_before + file_size,
            Some(total),
        );
        Ok(())
    }

    pub(crate) fn sftp_upload_dir(
        &self,
        session_id: &str,
        local_dir: &str,
        remote_parent: &str,
        remote_name: &str,
        transfer_mode: DirectoryTransferMode,
        events: Option<&EventSink>,
        transfer_id: Option<&str>,
    ) -> AppResult<()> {
        match transfer_mode {
            DirectoryTransferMode::Archive => self.sftp_upload_dir_archive(
                session_id,
                local_dir,
                remote_parent,
                remote_name,
                events,
                transfer_id,
            ),
            DirectoryTransferMode::Direct => self.sftp_upload_dir_direct(
                session_id,
                local_dir,
                remote_parent,
                remote_name,
                events,
                transfer_id,
            ),
        }
    }

    fn sftp_upload_dir_archive(
        &self,
        session_id: &str,
        local_dir: &str,
        remote_parent: &str,
        remote_name: &str,
        events: Option<&EventSink>,
        transfer_id: Option<&str>,
    ) -> AppResult<()> {
        let transfer = self.transfer_guard(transfer_id);
        emit_progress(events, transfer_id, "压缩中", 0, None);
        if let Some(transfer) = &transfer {
            transfer.check()?;
        }

        let local_archive = std::env::temp_dir().join(format!("mftp-up-{}.tar.gz", uuid_v4()));
        let _temp_cleanup = self.track_local_temp(local_archive.clone())?;
        if let Err(e) = pack_clean_tar_gz(
            local_dir,
            remote_name,
            &local_archive,
            events,
            transfer_id,
            transfer.as_ref(),
        ) {
            return Err(e);
        }
        if let Some(transfer) = &transfer {
            if let Err(e) = transfer.check() {
                return Err(e);
            }
        }

        let archive_size = std::fs::metadata(&local_archive)?.len();
        let remote_archive = join_remote(remote_parent, &format!(".mftp-up-{}.tar.gz", uuid_v4()));
        let _remote_archive = self.create_remote_temp_file(session_id, &remote_archive)?;
        self.upload_local_file_to_remote(
            session_id,
            &local_archive,
            &remote_archive,
            events,
            transfer_id,
            "上传压缩包中",
            0,
            archive_size,
            transfer.as_ref(),
        )?;

        if let Some(transfer) = &transfer {
            transfer.enter_unpausable()?;
        }
        emit_progress(events, transfer_id, "远端解压中", 0, None);
        let completion_marker = join_remote(remote_parent, &format!(".mftp-up-{}.done", uuid_v4()));
        let _marker = self.create_remote_temp_file(session_id, &completion_marker)?;
        let cmd = format!(
            "tar -xzf {} -C {} && printf 1 > {}",
            shell_quote(&remote_archive),
            shell_quote(remote_parent),
            shell_quote(&completion_marker),
        );
        match self.exec_checked_transfer(session_id, &cmd, transfer.as_ref()) {
            Ok(_) => Ok(()),
            Err(error) if stale_app_error(&error) => {
                emit_progress(events, transfer_id, "确认远端解压结果", 0, None);
                match self.confirm_remote_command_marker(
                    session_id,
                    &completion_marker,
                    transfer.as_ref(),
                ) {
                    Ok(true) => Ok(()),
                    Err(control) if control.kind == crate::error::AppErrorKind::Custom => {
                        Err(control)
                    }
                    _ => Err(error),
                }
            }
            Err(error) => Err(error),
        }
    }

    /// Upload a local directory recursively over SFTP.
    fn sftp_upload_dir_direct(
        &self,
        session_id: &str,
        local_dir: &str,
        remote_parent: &str,
        remote_name: &str,
        events: Option<&EventSink>,
        transfer_id: Option<&str>,
    ) -> AppResult<()> {
        let transfer = self.transfer_guard(transfer_id);
        emit_progress(events, transfer_id, "扫描中", 0, None);
        if let Some(transfer) = &transfer {
            transfer.check()?;
        }
        let remote_root = join_remote(remote_parent, remote_name);
        let plan = build_upload_plan(local_dir, &remote_root)?;
        if let Some(transfer) = &transfer {
            transfer.check()?;
        }

        let total = plan.total_file_bytes;
        let total_for_progress = if total == 0 { Some(1) } else { Some(total) };
        let mut uploaded = 0u64;
        let mut last_emit = Instant::now();
        emit_progress(events, transfer_id, "创建目录中", 0, total_for_progress);

        for entry in plan.entries {
            if let Some(transfer) = &transfer {
                transfer.check()?;
            }

            match entry.kind {
                UploadEntryKind::Directory => {
                    self.sftp_mkdir_existing_ok(session_id, &entry.remote)?;
                    if last_emit.elapsed() >= Duration::from_millis(120) {
                        emit_progress(
                            events,
                            transfer_id,
                            "上传文件夹中",
                            uploaded,
                            total_for_progress,
                        );
                        last_emit = Instant::now();
                    }
                }
                UploadEntryKind::File { size } => {
                    self.sftp_mkdir_existing_ok(session_id, &remote_parent_of(&entry.remote))?;
                    let temp_remote = remote_temp_sibling(&entry.remote);
                    let _remote_temp = self.create_remote_temp_file(session_id, &temp_remote)?;
                    self.upload_local_file_to_remote(
                        session_id,
                        &entry.local,
                        &temp_remote,
                        events,
                        transfer_id,
                        "上传文件夹中",
                        uploaded,
                        total,
                        transfer.as_ref(),
                    )?;
                    if let Some(transfer) = &transfer {
                        transfer.check()?;
                    }
                    self.sftp_rename_overwrite(session_id, &temp_remote, &entry.remote)?;
                    uploaded = uploaded.saturating_add(size);
                    if last_emit.elapsed() >= Duration::from_millis(120) || uploaded >= total {
                        emit_progress(
                            events,
                            transfer_id,
                            "上传文件夹中",
                            uploaded,
                            total_for_progress,
                        );
                        last_emit = Instant::now();
                    }
                }
                UploadEntryKind::Symlink { target } => {
                    self.sftp_symlink_overwrite(session_id, &target, &entry.remote)?;
                    if last_emit.elapsed() >= Duration::from_millis(120) {
                        emit_progress(
                            events,
                            transfer_id,
                            "上传文件夹中",
                            uploaded,
                            total_for_progress,
                        );
                        last_emit = Instant::now();
                    }
                }
            }
        }

        emit_progress(
            events,
            transfer_id,
            "完成",
            total_for_progress.unwrap_or(1),
            total_for_progress,
        );
        Ok(())
    }
}
