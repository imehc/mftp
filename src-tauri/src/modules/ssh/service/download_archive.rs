use super::super::ports::{emit_progress, EventSink};
use super::auth::connect;
use super::path_utils::{remote_basename, remote_parent_of, shell_quote, uuid_v4};
use super::remote_command_io::execute;
use super::transfer_retry::{run_transfer, AttemptError};
use super::types::{Manager, TransferGuard, TransferIoOutcome};
use crate::error::{AppError, AppResult};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::Path;
use std::time::{Duration, Instant};

impl Manager {
    fn stream_remote_dir_tar_gz(
        &self,
        session_id: &str,
        remote_dir: &str,
        local_archive: &Path,
        events: Option<&EventSink>,
        transfer_id: Option<&str>,
        transfer: Option<&TransferGuard>,
    ) -> AppResult<()> {
        let mat = self.material(session_id)?;
        let parent = remote_parent_of(remote_dir);
        let name = remote_basename(remote_dir);
        run_transfer(
            transfer,
            || connect(&mat),
            |session| {
                let cmd = format!(
                    "tar --exclude={} --exclude={} --exclude={} --exclude={} --exclude={} -czf - -C {} {}",
                    shell_quote("__MACOSX"), shell_quote(".DS_Store"), shell_quote("._*"),
                    shell_quote("Thumbs.db"), shell_quote("desktop.ini"), shell_quote(&parent),
                    shell_quote(&name),
                );
                let mut local_file = OpenOptions::new()
                    .create(true)
                    .write(true)
                    .truncate(true)
                    .open(local_archive)
                    .map_err(AttemptError::local)?;
                let mut transferred = 0;
                let mut last_emit = Instant::now();
                emit_progress(events, transfer_id, "下载压缩包中", 0, None);
                // Read both SSH streams directly. There is no remote stderr
                // file to leak if the peer disconnects or the transfer pauses.
                let output = execute(
                    session,
                    &cmd,
                    || self.command_control(session_id, &mat, transfer),
                    |bytes| {
                        local_file.write_all(bytes).map_err(AttemptError::local)?;
                        transferred += bytes.len() as u64;
                        if last_emit.elapsed() >= Duration::from_millis(120) {
                            emit_progress(events, transfer_id, "下载压缩包中", transferred, None);
                            last_emit = Instant::now();
                        }
                        Ok(())
                    },
                )?;
                local_file.flush().map_err(AttemptError::local)?;
                if output.outcome == TransferIoOutcome::Complete && output.exit_code != 0 {
                    return Err(AttemptError::remote(AppError::ssh_remote_exit(
                        output.exit_code,
                        &output.stderr,
                    )));
                }
                emit_progress(events, transfer_id, "下载压缩包中", transferred, None);
                Ok(output.outcome)
            },
            |_| {}, // Dedicated sessions are dropped, not stored in the SFTP cache.
            |_| emit_progress(events, transfer_id, "重连后重新下载压缩包", 0, None),
        )
    }

    pub(super) fn sftp_download_dir_archive(
        &self,
        session_id: &str,
        remote_dir: &str,
        local_dir: &str,
        events: Option<&EventSink>,
        transfer_id: Option<&str>,
    ) -> AppResult<()> {
        let transfer = self.transfer_guard(transfer_id);
        let local_archive = std::env::temp_dir().join(format!("mftp-dl-{}.tar.gz", uuid_v4()));
        let _temp_cleanup = self.track_local_temp(local_archive.clone())?;
        let result = self
            .stream_remote_dir_tar_gz(
                session_id,
                remote_dir,
                &local_archive,
                events,
                transfer_id,
                transfer.as_ref(),
            )
            .and_then(|_| {
                if let Some(transfer) = &transfer {
                    transfer.check()?;
                }
                emit_progress(events, transfer_id, "本地解压中", 0, None);
                self.extract_download(&local_archive, Path::new(local_dir), transfer.as_ref())
            });
        result
    }
}
