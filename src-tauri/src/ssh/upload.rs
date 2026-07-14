impl Manager {
    fn upload_local_file_to_remote(
        &self,
        session_id: &str,
        local: &Path,
        remote: &str,
        app: Option<&AppHandle>,
        transfer_id: Option<&str>,
        phase: &str,
        completed_before: u64,
        total: u64,
        transfer: Option<&TransferGuard>,
    ) -> AppResult<()> {
        let file_size = std::fs::metadata(local)?.len();
        let total = Some(total);
        let mut file_transferred = self
            .sftp_remote_file_size(session_id, remote)
            .unwrap_or(None)
            .unwrap_or(0)
            .min(file_size);
        let mut last_emit = Instant::now();
        let mut attempts = 0usize;

        loop {
            if let Some(transfer) = &transfer {
                transfer.check()?;
            }

            let conn = match self.sftp_conn(session_id) {
                Ok(conn) => conn,
                Err(error) if attempts < SFTP_TRANSFER_RETRIES && stale_app_error(&error) => {
                    attempts += 1;
                    emit_transfer_progress(
                        app,
                        transfer_id,
                        &format!("网络波动，正在重连（{attempts}/{SFTP_TRANSFER_RETRIES}）"),
                        completed_before + file_transferred,
                        total,
                    );
                    std::thread::sleep(transfer_retry_delay(attempts));
                    continue;
                }
                Err(error) => return Err(error),
            };
            let result: AppResult<TransferIoOutcome> = {
                let conn_guard = conn.lock();
                // Always re-read the server-side size. A short write may have
                // committed bytes before returning an error, so the local
                // counter alone is not a safe resume offset.
                file_transferred = match conn_guard.sftp.stat(Path::new(remote)) {
                    Ok(stat) => stat.size.unwrap_or(0).min(file_size),
                    Err(error) if stale_session_error(&error) => return Err(error.into()),
                    Err(_) => 0,
                };
                let mut remote_file = if file_transferred == 0 {
                    conn_guard.sftp.create(Path::new(remote))?
                } else {
                    conn_guard.sftp.open_mode(
                        Path::new(remote),
                        OpenFlags::WRITE,
                        0o644,
                        OpenType::File,
                    )?
                };
                let mut local_file = std::fs::File::open(local)?;
                let mut buf = [0u8; SFTP_TRANSFER_BUFFER_SIZE];

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
                            remote_file.flush()?;
                            break Ok(TransferIoOutcome::Paused);
                        }
                    }
                    let n = local_file.read(&mut buf)?;
                    if n == 0 {
                        remote_file.flush()?;
                        break Ok(TransferIoOutcome::Complete);
                    }
                    match write_sftp_buffer(
                        &mut remote_file,
                        &buf[..n],
                        &conn_guard.session,
                        transfer,
                    ) {
                        SftpWriteOutcome::Complete { written } => {
                            file_transferred += written as u64;
                            if written > 0 {
                                attempts = 0;
                            }
                        }
                        SftpWriteOutcome::Paused { written } => {
                            file_transferred += written as u64;
                            if written > 0 {
                                attempts = 0;
                            }
                            remote_file.flush()?;
                            break Ok(TransferIoOutcome::Paused);
                        }
                        SftpWriteOutcome::Failed { written, error } => {
                            file_transferred += written as u64;
                            break Err(error);
                        }
                    }
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
                        &format!("网络波动，正在续传（{attempts}/{SFTP_TRANSFER_RETRIES}）"),
                        completed_before + file_transferred,
                        total,
                    );
                    std::thread::sleep(transfer_retry_delay(attempts));
                }
                Err(e) => return Err(e),
            }
        }

        let actual_size = self
            .sftp_remote_file_size(session_id, remote)?
            .ok_or_else(|| AppError(format!("上传校验失败：远端临时文件不存在: {}", remote)))?;
        if actual_size != file_size {
            return Err(AppError(format!(
                "上传校验失败：远端文件大小为 {actual_size} 字节，本地文件大小为 {file_size} 字节"
            )));
        }
        emit_transfer_progress(app, transfer_id, phase, completed_before + file_size, total);
        Ok(())
    }

    pub fn sftp_upload_dir(
        &self,
        session_id: &str,
        local_dir: &str,
        remote_parent: &str,
        remote_name: &str,
        transfer_mode: DirectoryTransferMode,
        app: Option<&AppHandle>,
        transfer_id: Option<&str>,
    ) -> AppResult<()> {
        match transfer_mode {
            DirectoryTransferMode::Archive => self.sftp_upload_dir_archive(
                session_id,
                local_dir,
                remote_parent,
                remote_name,
                app,
                transfer_id,
            ),
            DirectoryTransferMode::Direct => self.sftp_upload_dir_direct(
                session_id,
                local_dir,
                remote_parent,
                remote_name,
                app,
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
        app: Option<&AppHandle>,
        transfer_id: Option<&str>,
    ) -> AppResult<()> {
        let transfer = self.transfer_guard(transfer_id);
        emit_transfer_progress(app, transfer_id, "压缩中", 0, None);
        if let Some(transfer) = &transfer {
            transfer.check()?;
        }

        let local_archive = std::env::temp_dir().join(format!("mftp-up-{}.tar.gz", uuid_v4()));
        let _temp_cleanup = self.track_local_temp(local_archive.clone())?;
        if let Err(e) = pack_clean_tar_gz(
            local_dir,
            remote_name,
            &local_archive,
            app,
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
        let upload_res = self.upload_local_file_to_remote(
            session_id,
            &local_archive,
            &remote_archive,
            app,
            transfer_id,
            "上传压缩包中",
            0,
            archive_size,
            transfer.as_ref(),
        );
        if let Err(e) = upload_res {
            let _ = self.remove_remote_path_if_file(session_id, &remote_archive);
            return Err(e);
        }

        if let Some(transfer) = &transfer {
            if let Err(e) = transfer.check() {
                let _ = self.remove_remote_path_if_file(session_id, &remote_archive);
                return Err(e);
            }
        }

        if let Some(transfer) = &transfer {
            transfer.enter_unpausable()?;
        }
        emit_transfer_progress(app, transfer_id, "远端解压中", 0, None);
        let completion_marker = join_remote(remote_parent, &format!(".mftp-up-{}.done", uuid_v4()));
        let cmd = format!(
            "tar -xzf {} -C {} && : > {}",
            shell_quote(&remote_archive),
            shell_quote(remote_parent),
            shell_quote(&completion_marker),
        );
        let extract_res = match self.exec_checked(session_id, &cmd) {
            Ok(_) => Ok(()),
            Err(error) if stale_app_error(&error) => {
                emit_transfer_progress(app, transfer_id, "确认远端解压结果", 0, None);
                if self.confirm_remote_command_marker(session_id, &completion_marker) {
                    Ok(())
                } else {
                    Err(error)
                }
            }
            Err(error) => Err(error),
        };
        let _ = self.remove_remote_path_if_file(session_id, &completion_marker);
        let _ = self.remove_remote_path_if_file(session_id, &remote_archive);
        extract_res
    }

    /// Upload a local directory recursively over SFTP.
    fn sftp_upload_dir_direct(
        &self,
        session_id: &str,
        local_dir: &str,
        remote_parent: &str,
        remote_name: &str,
        app: Option<&AppHandle>,
        transfer_id: Option<&str>,
    ) -> AppResult<()> {
        let transfer = self.transfer_guard(transfer_id);
        emit_transfer_progress(app, transfer_id, "扫描中", 0, None);
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
        emit_transfer_progress(app, transfer_id, "创建目录中", 0, total_for_progress);

        for entry in plan.entries {
            if let Some(transfer) = &transfer {
                transfer.check()?;
            }

            match entry.kind {
                UploadEntryKind::Directory => {
                    self.sftp_mkdir_existing_ok(session_id, &entry.remote)?;
                    if last_emit.elapsed() >= Duration::from_millis(120) {
                        emit_transfer_progress(
                            app,
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
                    let upload_res = self.upload_local_file_to_remote(
                        session_id,
                        &entry.local,
                        &temp_remote,
                        app,
                        transfer_id,
                        "上传文件夹中",
                        uploaded,
                        total,
                        transfer.as_ref(),
                    );
                    if let Err(e) = upload_res {
                        let _ = self.remove_remote_path_if_file(session_id, &temp_remote);
                        return Err(e);
                    }
                    if let Err(e) =
                        self.sftp_rename_overwrite(session_id, &temp_remote, &entry.remote)
                    {
                        let _ = self.remove_remote_path_if_file(session_id, &temp_remote);
                        return Err(e);
                    }
                    uploaded = uploaded.saturating_add(size);
                    if last_emit.elapsed() >= Duration::from_millis(120) || uploaded >= total {
                        emit_transfer_progress(
                            app,
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
                        emit_transfer_progress(
                            app,
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

        emit_transfer_progress(
            app,
            transfer_id,
            "完成",
            total_for_progress.unwrap_or(1),
            total_for_progress,
        );
        Ok(())
    }
}
