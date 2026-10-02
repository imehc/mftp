use super::errors::stale_session_error;
use super::path_utils::{join_remote, shell_quote};
use super::transfer_models::{
    parse_remote_birth_time, DownloadEntry, DownloadEntryKind, DownloadPlan,
};
use super::transfer_retry::SFTP_TRANSFER_RETRIES;
use super::types::Manager;
use crate::error::{AppError, AppResult, CustomErrorCode};
use ssh2::{FileStat, RenameFlags};
use std::path::{Path, PathBuf};
use std::time::Duration;

// SFTP v3 NO_SUCH_FILE and v4 NO_SUCH_PATH indicate absence. Permission,
// authentication and other failures must not authorize a truncating create.
pub(super) fn remote_file_size(result: Result<FileStat, ssh2::Error>) -> AppResult<Option<u64>> {
    match result {
        Ok(stat) => stat
            .size
            .map(Some)
            .ok_or_else(|| AppError::ssh_invalid_response("SFTP stat response omitted file size")),
        Err(error) if matches!(error.code(), ssh2::ErrorCode::SFTP(2 | 10)) => Ok(None),
        Err(error) => Err(error.into()),
    }
}

impl Manager {
    pub(super) fn sftp_birth_time(&self, session_id: &str, path: &str) -> Option<u64> {
        let path = shell_quote(path);
        let cmd = format!("(stat -c %W -- {path} 2>/dev/null || stat -f %B {path} 2>/dev/null)");
        let Ok((0, stdout, _)) = self.exec(session_id, &cmd) else {
            return None;
        };
        parse_remote_birth_time(&stdout)
    }

    /// Whether a remote path exists.
    pub fn sftp_exists(&self, session_id: &str, path: &str) -> AppResult<bool> {
        let conn = self.sftp_conn(session_id)?;
        let conn = conn.lock();
        Ok(conn.sftp.stat(Path::new(path)).is_ok())
    }

    pub(super) fn sftp_mkdir_existing_ok(&self, session_id: &str, path: &str) -> AppResult<()> {
        let mut attempts = 0usize;
        loop {
            let conn = self.sftp_conn(session_id)?;
            let result: Result<(), ssh2::Error> = {
                let conn_guard = conn.lock();
                if conn_guard
                    .sftp
                    .stat(Path::new(path))
                    .is_ok_and(|stat| stat.is_dir())
                {
                    return Ok(());
                }
                conn_guard.sftp.mkdir(Path::new(path), 0o755)
            };
            match result {
                Ok(()) => return Ok(()),
                Err(e) if stale_session_error(&e) && attempts < SFTP_TRANSFER_RETRIES => {
                    attempts += 1;
                    self.remove_sftp_conn_if_current(session_id, &conn);
                    std::thread::sleep(Duration::from_millis(250));
                }
                Err(e) if stale_session_error(&e) => return Err(e.into()),
                Err(e) => {
                    let conn = self.sftp_conn(session_id)?;
                    let conn_guard = conn.lock();
                    if conn_guard
                        .sftp
                        .stat(Path::new(path))
                        .is_ok_and(|stat| stat.is_dir())
                    {
                        return Ok(());
                    }
                    return Err(e.into());
                }
            }
        }
    }

    pub(super) fn sftp_rename_overwrite(
        &self,
        session_id: &str,
        from: &str,
        to: &str,
    ) -> AppResult<()> {
        let mut attempts = 0usize;
        loop {
            let conn = self.sftp_conn(session_id)?;
            let result = {
                let conn_guard = conn.lock();
                conn_guard.sftp.rename(
                    Path::new(from),
                    Path::new(to),
                    Some(RenameFlags::ATOMIC | RenameFlags::OVERWRITE | RenameFlags::NATIVE),
                )
            };
            match result {
                Ok(()) => return Ok(()),
                Err(e) if stale_session_error(&e) && attempts < SFTP_TRANSFER_RETRIES => {
                    attempts += 1;
                    self.remove_sftp_conn_if_current(session_id, &conn);
                    std::thread::sleep(Duration::from_millis(250));
                }
                Err(e) => return Err(e.into()),
            }
        }
    }

    pub(super) fn sftp_symlink_overwrite(
        &self,
        session_id: &str,
        target: &str,
        link: &str,
    ) -> AppResult<()> {
        let mut attempts = 0usize;
        loop {
            let conn = self.sftp_conn(session_id)?;
            let result = {
                let conn_guard = conn.lock();
                let _ = conn_guard.sftp.unlink(Path::new(link));
                conn_guard.sftp.symlink(Path::new(target), Path::new(link))
            };
            match result {
                Ok(()) => return Ok(()),
                Err(e) if stale_session_error(&e) && attempts < SFTP_TRANSFER_RETRIES => {
                    attempts += 1;
                    self.remove_sftp_conn_if_current(session_id, &conn);
                    std::thread::sleep(Duration::from_millis(250));
                }
                Err(e) => return Err(e.into()),
            }
        }
    }

    pub(super) fn sftp_lstat_retry(&self, session_id: &str, path: &str) -> AppResult<FileStat> {
        let mut attempts = 0usize;
        loop {
            let conn = self.sftp_conn(session_id)?;
            let result = {
                let conn_guard = conn.lock();
                conn_guard.sftp.lstat(Path::new(path))
            };
            match result {
                Ok(stat) => return Ok(stat),
                Err(e) if stale_session_error(&e) && attempts < SFTP_TRANSFER_RETRIES => {
                    attempts += 1;
                    self.remove_sftp_conn_if_current(session_id, &conn);
                    std::thread::sleep(Duration::from_millis(250));
                }
                Err(e) => return Err(e.into()),
            }
        }
    }

    fn sftp_readdir_retry(
        &self,
        session_id: &str,
        path: &str,
    ) -> AppResult<Vec<(PathBuf, FileStat)>> {
        let mut attempts = 0usize;
        loop {
            let conn = self.sftp_conn(session_id)?;
            let result = {
                let conn_guard = conn.lock();
                conn_guard.sftp.readdir(Path::new(path))
            };
            match result {
                Ok(entries) => return Ok(entries),
                Err(e) if stale_session_error(&e) && attempts < SFTP_TRANSFER_RETRIES => {
                    attempts += 1;
                    self.remove_sftp_conn_if_current(session_id, &conn);
                    std::thread::sleep(Duration::from_millis(250));
                }
                Err(e) => return Err(e.into()),
            }
        }
    }

    fn sftp_readlink_retry(&self, session_id: &str, path: &str) -> AppResult<String> {
        let mut attempts = 0usize;
        loop {
            let conn = self.sftp_conn(session_id)?;
            let result = {
                let conn_guard = conn.lock();
                conn_guard.sftp.readlink(Path::new(path))
            };
            match result {
                Ok(target) => return Ok(target.to_string_lossy().to_string()),
                Err(e) if stale_session_error(&e) && attempts < SFTP_TRANSFER_RETRIES => {
                    attempts += 1;
                    self.remove_sftp_conn_if_current(session_id, &conn);
                    std::thread::sleep(Duration::from_millis(250));
                }
                Err(e) => return Err(e.into()),
            }
        }
    }

    pub(super) fn build_download_plan(
        &self,
        session_id: &str,
        remote_dir: &str,
        local_dir: &str,
    ) -> AppResult<DownloadPlan> {
        let mut plan = DownloadPlan {
            entries: Vec::new(),
            total_file_bytes: 0,
        };
        self.collect_download_entry(
            session_id,
            remote_dir,
            Path::new(local_dir).to_path_buf(),
            &mut plan,
        )?;
        Ok(plan)
    }

    fn collect_download_entry(
        &self,
        session_id: &str,
        remote: &str,
        local: PathBuf,
        plan: &mut DownloadPlan,
    ) -> AppResult<()> {
        let stat = self.sftp_lstat_retry(session_id, remote)?;
        if stat.is_dir() {
            plan.entries.push(DownloadEntry {
                remote: remote.to_string(),
                local: local.clone(),
                kind: DownloadEntryKind::Directory,
            });
            for (path, _) in self.sftp_readdir_retry(session_id, remote)? {
                let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
                    continue;
                };
                if name.is_empty() || name == "." || name == ".." {
                    continue;
                }
                self.collect_download_entry(
                    session_id,
                    &join_remote(remote, name),
                    local.join(name),
                    plan,
                )?;
            }
        } else if stat.file_type().is_symlink() {
            let target = self.sftp_readlink_retry(session_id, remote)?;
            plan.entries.push(DownloadEntry {
                remote: remote.to_string(),
                local,
                kind: DownloadEntryKind::Symlink { target },
            });
        } else if stat.is_file() {
            let size = stat.size.unwrap_or(0);
            plan.total_file_bytes = plan.total_file_bytes.saturating_add(size);
            plan.entries.push(DownloadEntry {
                remote: remote.to_string(),
                local,
                kind: DownloadEntryKind::File { size },
            });
        } else {
            return Err(
                AppError::custom(CustomErrorCode::SftpUnsupportedFile).with_arg("path", remote)
            );
        }
        Ok(())
    }
}
