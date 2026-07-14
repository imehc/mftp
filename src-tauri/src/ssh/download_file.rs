impl Manager {
    fn download_remote_file_to_local(
        &self,
        session_id: &str,
        remote: &str,
        local: &Path,
        expected_size: u64,
        app: Option<&AppHandle>,
        transfer_id: Option<&str>,
        phase: &str,
        completed_before: u64,
        total: u64,
        transfer: Option<&TransferGuard>,
    ) -> AppResult<()> {
        let total = Some(total);
        let mut file_transferred = std::fs::metadata(local)
            .ok()
            .map(|meta| meta.len())
            .unwrap_or(0)
            .min(expected_size);
        let mut last_emit = Instant::now();
        let mut attempts = 0usize;

        loop {
            if let Some(transfer) = &transfer {
                transfer.check()?;
            }

            let conn = self.sftp_conn(session_id)?;
            let result: AppResult<TransferIoOutcome> = {
                let conn_guard = conn.lock();
                let mut remote_file = conn_guard.sftp.open(Path::new(remote))?;
                let mut local_file = OpenOptions::new().create(true).write(true).open(local)?;
                let mut buf = [0u8; SFTP_TRANSFER_BUFFER_SIZE];
                let mut last_keepalive = Instant::now();

                if file_transferred > 0 {
                    remote_file.seek(SeekFrom::Start(file_transferred))?;
                    local_file.seek(SeekFrom::Start(file_transferred))?;
                }

                emit_transfer_progress(
                    app,
                    transfer_id,
                    phase,
                    completed_before + file_transferred,
                    total,
                );
                loop {
                    if let Some(transfer) = &transfer {
                        if transfer.io_paused()? {
                            local_file.flush()?;
                            break Ok(TransferIoOutcome::Paused);
                        }
                    }
                    let n = remote_file.read(&mut buf)?;
                    if n == 0 {
                        local_file.flush()?;
                        break Ok(TransferIoOutcome::Complete);
                    }
                    local_file.write_all(&buf[..n])?;
                    file_transferred += n as u64;
                    attempts = 0;
                    if last_emit.elapsed() >= Duration::from_millis(120) {
                        emit_transfer_progress(
                            app,
                            transfer_id,
                            phase,
                            completed_before + file_transferred,
                            total,
                        );
                        last_emit = Instant::now();
                    }
                    if last_keepalive.elapsed() >= Duration::from_secs(SFTP_TRANSFER_KEEPALIVE_SECS)
                    {
                        let _ = conn_guard.session.keepalive_send();
                        last_keepalive = Instant::now();
                    }
                }
            };

            match result {
                Ok(TransferIoOutcome::Complete) => break,
                Ok(TransferIoOutcome::Paused) => {
                    if let Some(transfer) = &transfer {
                        transfer.check()?;
                    }
                }
                Err(e) if attempts < SFTP_TRANSFER_RETRIES && stale_app_error(&e) => {
                    attempts += 1;
                    self.remove_sftp_conn_if_current(session_id, &conn);
                    emit_transfer_progress(
                        app,
                        transfer_id,
                        "重连后继续下载",
                        completed_before + file_transferred,
                        total,
                    );
                    std::thread::sleep(Duration::from_millis(250));
                }
                Err(e) => return Err(e),
            }
        }

        let actual_size = std::fs::metadata(local)?.len();
        if actual_size != expected_size {
            return Err(AppError(format!(
                "下载校验失败：本地文件大小为 {actual_size} 字节，远端文件大小为 {expected_size} 字节"
            )));
        }
        emit_transfer_progress(
            app,
            transfer_id,
            phase,
            completed_before + expected_size,
            total,
        );
        Ok(())
    }

    pub fn sftp_download_dir(
        &self,
        session_id: &str,
        remote_dir: &str,
        local_dir: &str,
        transfer_mode: DirectoryTransferMode,
        app: Option<&AppHandle>,
        transfer_id: Option<&str>,
    ) -> AppResult<()> {
        match transfer_mode {
            DirectoryTransferMode::Archive => {
                self.sftp_download_dir_archive(session_id, remote_dir, local_dir, app, transfer_id)
            }
            DirectoryTransferMode::Direct => {
                self.sftp_download_dir_direct(session_id, remote_dir, local_dir, app, transfer_id)
            }
        }
    }
}
