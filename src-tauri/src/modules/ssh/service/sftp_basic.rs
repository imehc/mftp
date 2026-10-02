use super::super::ports::emit_progress;
use super::super::ports::EventSink;
use super::errors::stale_session_error;
use super::path_utils::{
    is_protected_remote_path, local_temp_sibling, remote_temp_sibling, rename_local_file_overwrite,
    shell_quote,
};
use super::transfer_models::{sftp_entries, sftp_file_info};
use super::types::Manager;
use crate::error::{AppError, AppResult, CustomErrorCode};
use crate::modules::ssh::{SftpEntry, SftpFileInfo};
use std::path::Path;

impl Manager {
    pub fn sftp_home(&self, session_id: &str) -> AppResult<String> {
        let conn = self.sftp_conn(session_id)?;
        let conn = conn.lock();
        // realpath(".") resolves the login directory.
        let home = conn.sftp.realpath(Path::new("."))?;
        Ok(home.to_string_lossy().to_string())
    }

    /// Resolve the directory to open first: the host's configured default if it
    /// exists, otherwise the login/home directory, otherwise "/".
    pub fn sftp_start_dir(&self, session_id: &str, preferred: Option<&str>) -> AppResult<String> {
        let conn = self.sftp_conn(session_id)?;
        let conn = conn.lock();
        if let Some(p) = preferred {
            let p = p.trim();
            if !p.is_empty() {
                // stat() succeeds only if the path exists and is reachable.
                if let Ok(stat) = conn.sftp.stat(Path::new(p)) {
                    if stat.is_dir() {
                        if let Ok(real) = conn.sftp.realpath(Path::new(p)) {
                            return Ok(real.to_string_lossy().to_string());
                        }
                        return Ok(p.to_string());
                    }
                }
            }
        }
        // Fall back to the home directory, then root.
        match conn.sftp.realpath(Path::new(".")) {
            Ok(home) => Ok(home.to_string_lossy().to_string()),
            Err(_) => Ok("/".to_string()),
        }
    }

    pub fn sftp_list(&self, session_id: &str, path: &str) -> AppResult<Vec<SftpEntry>> {
        let conn = self.sftp_conn(session_id)?;
        let base = Path::new(path);
        let read_dir = {
            let conn_guard = conn.lock();
            conn_guard.sftp.readdir(base)
        };
        let read_dir = match read_dir {
            Ok(read_dir) => read_dir,
            Err(e) if stale_session_error(&e) => {
                self.remove_sftp_conn_if_current(session_id, &conn);
                let retry = self.sftp_conn(session_id)?;
                let retry = retry.lock();
                retry.sftp.readdir(base)?
            }
            Err(e) => return Err(e.into()),
        };
        Ok(sftp_entries(read_dir))
    }

    pub fn sftp_info(&self, session_id: &str, path: &str) -> AppResult<SftpFileInfo> {
        let stat = self.sftp_lstat_retry(session_id, path)?;
        let created_at = self.sftp_birth_time(session_id, path);
        Ok(sftp_file_info(path, stat, created_at))
    }

    pub fn sftp_mkdir(&self, session_id: &str, path: &str) -> AppResult<()> {
        let conn = self.sftp_conn(session_id)?;
        let conn = conn.lock();
        conn.sftp.mkdir(Path::new(path), 0o755)?;
        Ok(())
    }

    pub fn sftp_rename(&self, session_id: &str, from: &str, to: &str) -> AppResult<()> {
        let conn = self.sftp_conn(session_id)?;
        let conn = conn.lock();
        conn.sftp.rename(Path::new(from), Path::new(to), None)?;
        Ok(())
    }

    pub(crate) fn sftp_delete(
        &self,
        session_id: &str,
        path: &str,
        is_dir: bool,
        events: Option<&EventSink>,
        transfer_id: Option<&str>,
    ) -> AppResult<()> {
        if is_protected_remote_path(path) {
            return Err(AppError::custom(CustomErrorCode::SftpProtectedPath));
        }

        if is_dir {
            emit_progress(events, transfer_id, "远端删除中", 0, None);
            let transfer = self.transfer_guard(transfer_id);
            if let Some(transfer) = &transfer {
                transfer.enter_unpausable()?;
            }
            self.exec_checked_transfer(
                session_id,
                &format!("rm -rf -- {}", shell_quote(path)),
                transfer.as_ref(),
            )?;
            emit_progress(events, transfer_id, "完成", 1, Some(1));
            return Ok(());
        }

        let conn = self.sftp_conn(session_id)?;
        let conn = conn.lock();
        conn.sftp.unlink(Path::new(path))?;
        Ok(())
    }

    /// Download a remote file to a local path.
    pub(crate) fn sftp_download(
        &self,
        session_id: &str,
        remote: &str,
        local: &str,
        events: Option<&EventSink>,
        transfer_id: Option<&str>,
    ) -> AppResult<()> {
        let transfer = self.transfer_guard(transfer_id);
        let final_path = Path::new(local);
        let temp_local = local_temp_sibling(final_path);
        let _temp_cleanup = self.track_local_temp(temp_local.clone())?;
        self.download_remote_file_to_local(
            session_id,
            remote,
            &temp_local,
            None,
            events,
            transfer_id,
            "下载中",
            0,
            None,
            transfer.as_ref(),
        )?;
        let transferred = std::fs::metadata(&temp_local)?.len();
        rename_local_file_overwrite(&temp_local, final_path)?;
        emit_progress(events, transfer_id, "完成", transferred, Some(transferred));
        Ok(())
    }

    /// Upload a local file to a remote path.
    pub(crate) fn sftp_upload(
        &self,
        session_id: &str,
        local: &str,
        remote: &str,
        events: Option<&EventSink>,
        transfer_id: Option<&str>,
    ) -> AppResult<()> {
        let transfer = self.transfer_guard(transfer_id);
        let total = std::fs::metadata(local)?.len();
        let temp_remote = remote_temp_sibling(remote);
        emit_progress(events, transfer_id, "上传中", 0, Some(total));
        if let Some(transfer) = &transfer {
            transfer.check()?;
        }
        let _remote_temp = self.create_remote_temp_file(session_id, &temp_remote)?;
        self.upload_local_file_to_remote(
            session_id,
            Path::new(local),
            &temp_remote,
            events,
            transfer_id,
            "上传中",
            0,
            total,
            transfer.as_ref(),
        )?;
        if let Some(transfer) = &transfer {
            transfer.check()?;
        }
        self.sftp_rename_overwrite(session_id, &temp_remote, remote)?;
        emit_progress(events, transfer_id, "完成", total, Some(total));
        Ok(())
    }
}
