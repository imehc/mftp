impl Manager {
    /// Get (or lazily create) the SFTP connection for this session. The SFTP
    /// subsystem is initialized once here and reused for every subsequent call.
    fn sftp_conn(&self, session_id: &str) -> AppResult<Arc<Mutex<SftpConn>>> {
        let cached = { self.sftp.lock().get(session_id).cloned() };
        if let Some(conn) = cached {
            return Ok(conn);
        }
        let mat = self.material(session_id)?;
        let sess = connect(&mat)?;
        let sftp = sess.sftp()?;
        let arc = Arc::new(Mutex::new(SftpConn {
            sftp,
            session: sess,
        }));
        let mut sftp = self.sftp.lock();
        if let Some(current) = sftp.get(session_id) {
            return Ok(current.clone());
        }
        sftp.insert(session_id.to_string(), arc.clone());
        Ok(arc)
    }

    fn remove_sftp_conn_if_current(&self, session_id: &str, conn: &Arc<Mutex<SftpConn>>) {
        let mut sftp = self.sftp.lock();
        if sftp
            .get(session_id)
            .is_some_and(|current| Arc::ptr_eq(current, conn))
        {
            sftp.remove(session_id);
        }
    }

    pub fn reset_sftp_conn(&self, session_id: &str) {
        self.sftp.lock().remove(session_id);
    }

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

    pub fn sftp_delete(
        &self,
        session_id: &str,
        path: &str,
        is_dir: bool,
        app: Option<&AppHandle>,
        transfer_id: Option<&str>,
    ) -> AppResult<()> {
        if is_protected_remote_path(path) {
            return Err(AppError("拒绝删除根目录或空路径".into()));
        }

        if is_dir {
            emit_transfer_progress(app, transfer_id, "远端删除中", 0, None);
            self.exec_checked(session_id, &format!("rm -rf -- {}", shell_quote(path)))?;
            emit_transfer_progress(app, transfer_id, "完成", 1, Some(1));
            return Ok(());
        }

        let conn = self.sftp_conn(session_id)?;
        let conn = conn.lock();
        conn.sftp.unlink(Path::new(path))?;
        Ok(())
    }

    /// Download a remote file to a local path.
    pub fn sftp_download(
        &self,
        session_id: &str,
        remote: &str,
        local: &str,
        app: Option<&AppHandle>,
        transfer_id: Option<&str>,
    ) -> AppResult<()> {
        let transfer = self.transfer_guard(transfer_id);
        let final_path = Path::new(local);
        let temp_local = local_temp_sibling(final_path);
        let _temp_cleanup = self.track_local_temp(temp_local.clone())?;
        let total = self.sftp_conn(session_id).ok().and_then(|conn| {
            let conn = conn.lock();
            conn.sftp.stat(Path::new(remote)).ok()?.size
        });
        let mut local_file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&temp_local)?;
        let mut buf = [0u8; SFTP_TRANSFER_BUFFER_SIZE];
        let mut transferred = 0u64;
        let mut last_emit = Instant::now();
        let mut attempts = 0usize;

        emit_transfer_progress(app, transfer_id, "下载中", 0, total);
        loop {
            if let Some(transfer) = &transfer {
                if let Err(e) = transfer.check() {
                    return Err(e);
                }
            }
            let conn = self.sftp_conn(session_id)?;
            let transfer_result: AppResult<TransferIoOutcome> = {
                let conn_guard = conn.lock();
                let mut remote_file = conn_guard.sftp.open(Path::new(remote))?;
                let mut last_keepalive = Instant::now();
                if transferred > 0 {
                    remote_file.seek(SeekFrom::Start(transferred))?;
                    local_file.seek(SeekFrom::Start(transferred))?;
                }
                loop {
                    if let Some(transfer) = &transfer {
                        if transfer.io_paused()? {
                            local_file.flush()?;
                            break Ok(TransferIoOutcome::Paused);
                        }
                    }
                    let n = remote_file.read(&mut buf)?;
                    if n == 0 {
                        break Ok(TransferIoOutcome::Complete);
                    }
                    local_file.write_all(&buf[..n])?;
                    transferred += n as u64;
                    attempts = 0;
                    if last_emit.elapsed() >= Duration::from_millis(120) {
                        emit_transfer_progress(app, transfer_id, "下载中", transferred, total);
                        last_emit = Instant::now();
                    }
                    if last_keepalive.elapsed() >= Duration::from_secs(SFTP_TRANSFER_KEEPALIVE_SECS)
                    {
                        let _ = conn_guard.session.keepalive_send();
                        last_keepalive = Instant::now();
                    }
                }
            };
            match transfer_result {
                Ok(TransferIoOutcome::Complete) => break,
                Ok(TransferIoOutcome::Paused) => {
                    if let Some(transfer) = &transfer {
                        if let Err(error) = transfer.check() {
                            return Err(error);
                        }
                    }
                }
                Err(e) if attempts < SFTP_TRANSFER_RETRIES && stale_app_error(&e) => {
                    attempts += 1;
                    self.remove_sftp_conn_if_current(session_id, &conn);
                    emit_transfer_progress(app, transfer_id, "重连后继续下载", transferred, total);
                    std::thread::sleep(Duration::from_millis(250));
                }
                Err(e) => return Err(e),
            }
        }
        if let Some(transfer) = &transfer {
            if let Err(e) = transfer.check() {
                return Err(e);
            }
        }
        local_file.flush()?;
        drop(local_file);
        if let Some(expected) = total {
            if transferred != expected {
                return Err(AppError(format!(
                    "下载校验失败：本地临时文件大小为 {transferred} 字节，远端文件大小为 {expected} 字节"
                )));
            }
        }
        rename_local_file_overwrite(&temp_local, final_path)?;
        emit_transfer_progress(app, transfer_id, "完成", total.unwrap_or(transferred), total);
        Ok(())
    }

    /// Upload a local file to a remote path.
    pub fn sftp_upload(
        &self,
        session_id: &str,
        local: &str,
        remote: &str,
        app: Option<&AppHandle>,
        transfer_id: Option<&str>,
    ) -> AppResult<()> {
        let transfer = self.transfer_guard(transfer_id);
        let total = std::fs::metadata(local)?.len();
        let temp_remote = remote_temp_sibling(remote);
        emit_transfer_progress(app, transfer_id, "上传中", 0, Some(total));
        let upload_res = self.upload_local_file_to_remote(
            session_id,
            Path::new(local),
            &temp_remote,
            app,
            transfer_id,
            "上传中",
            0,
            total,
            transfer.as_ref(),
        );
        if let Err(e) = upload_res {
            let _ = self.remove_remote_path_if_file(session_id, &temp_remote);
            return Err(e);
        }
        if let Some(transfer) = &transfer {
            if let Err(e) = transfer.check() {
                let _ = self.remove_remote_path_if_file(session_id, &temp_remote);
                return Err(e);
            }
        }
        if let Err(e) = self.sftp_rename_overwrite(session_id, &temp_remote, remote) {
            let _ = self.remove_remote_path_if_file(session_id, &temp_remote);
            return Err(e);
        }
        emit_transfer_progress(app, transfer_id, "完成", total, Some(total));
        Ok(())
    }
}
