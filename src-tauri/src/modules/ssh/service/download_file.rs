use super::super::ports::{emit_progress, EventSink};
use super::auth::SSH_OPERATION_TIMEOUT_MS;
use super::transfer_io::{copy_download, seek_transfer, verify_size};
use super::transfer_retry::{run_transfer, AttemptError};
use super::types::{DirectoryTransferMode, Manager, TransferGuard};
use crate::error::AppResult;
use std::cell::Cell;
use std::fs::OpenOptions;
use std::path::Path;
use std::time::{Duration, Instant};

impl Manager {
    pub(super) fn download_remote_file_to_local(
        &self,
        session_id: &str,
        remote: &str,
        local: &Path,
        expected_size: Option<u64>,
        events: Option<&EventSink>,
        transfer_id: Option<&str>,
        phase: &str,
        completed_before: u64,
        total: Option<u64>,
        transfer: Option<&TransferGuard>,
    ) -> AppResult<()> {
        let mut local_file = OpenOptions::new().create(true).write(true).open(local)?;
        let initial_size = local_file.metadata()?.len();
        let transferred =
            Cell::new(expected_size.map_or(initial_size, |size| initial_size.min(size)));
        let expected = Cell::new(expected_size);
        let mut last_emit = Instant::now();
        run_transfer(
            transfer,
            || self.sftp_conn(session_id),
            |connection| {
                let conn = connection.lock();
                // Cached exec channels may have disabled the timeout. Restore
                // the normal bound before transfer IO so reads cannot hang forever.
                conn.session.set_timeout(SSH_OPERATION_TIMEOUT_MS);
                let mut remote_file = conn
                    .sftp
                    .open(Path::new(remote))
                    .map_err(AttemptError::remote)?;
                if expected.get().is_none() {
                    expected.set(remote_file.stat().map_err(AttemptError::remote)?.size);
                }
                // Discard an old tail before resuming. Offset advances only
                // after a whole local write; local failures terminate the task.
                local_file
                    .set_len(transferred.get())
                    .map_err(AttemptError::local)?;
                seek_transfer(&mut local_file, &mut remote_file, transferred.get())?;
                emit_progress(
                    events,
                    transfer_id,
                    phase,
                    completed_before + transferred.get(),
                    total.or(expected.get()),
                );
                copy_download(
                    &mut remote_file,
                    &mut local_file,
                    transfer,
                    |count| {
                        transferred.set(transferred.get() + count as u64);
                        if last_emit.elapsed() >= Duration::from_millis(120) {
                            emit_progress(
                                events,
                                transfer_id,
                                phase,
                                completed_before + transferred.get(),
                                total.or(expected.get()),
                            );
                            last_emit = Instant::now();
                        }
                    },
                    || {
                        let _ = conn.session.keepalive_send();
                    },
                )
            },
            |conn| self.remove_sftp_conn_if_current(session_id, conn),
            |_| {
                emit_progress(
                    events,
                    transfer_id,
                    "重连后继续下载",
                    completed_before + transferred.get(),
                    total.or(expected.get()),
                )
            },
        )?;
        verify_size(
            local_file.metadata()?.len(),
            expected.get(),
            &local.to_string_lossy(),
        )?;
        emit_progress(
            events,
            transfer_id,
            phase,
            completed_before + transferred.get(),
            total.or(expected.get()),
        );
        Ok(())
    }

    pub(crate) fn sftp_download_dir(
        &self,
        session_id: &str,
        remote_dir: &str,
        local_dir: &str,
        transfer_mode: DirectoryTransferMode,
        events: Option<&EventSink>,
        transfer_id: Option<&str>,
    ) -> AppResult<()> {
        match transfer_mode {
            DirectoryTransferMode::Archive => self.sftp_download_dir_archive(
                session_id,
                remote_dir,
                local_dir,
                events,
                transfer_id,
            ),
            DirectoryTransferMode::Direct => self.sftp_download_dir_direct(
                session_id,
                remote_dir,
                local_dir,
                events,
                transfer_id,
            ),
        }
    }
}
