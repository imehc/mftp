impl Manager {
    fn stream_remote_dir_tar_gz(
        &self,
        session_id: &str,
        remote_dir: &str,
        local_archive: &Path,
        app: Option<&AppHandle>,
        transfer_id: Option<&str>,
        transfer: Option<&TransferGuard>,
    ) -> AppResult<()> {
        let mat = self.material(session_id)?;
        let parent = remote_parent_of(remote_dir);
        let name = remote_basename(remote_dir);
        let remote_stderr = format!("/tmp/.mftp-dl-{}.stderr", uuid_v4());
        let cmd = format!(
            "tar --exclude={} --exclude={} --exclude={} --exclude={} --exclude={} -czf - -C {} {} 2> {}",
            shell_quote("__MACOSX"),
            shell_quote(".DS_Store"),
            shell_quote("._*"),
            shell_quote("Thumbs.db"),
            shell_quote("desktop.ini"),
            shell_quote(&parent),
            shell_quote(&name),
            shell_quote(&remote_stderr)
        );
        let mut attempts = 0usize;

        loop {
            if let Some(transfer) = transfer {
                transfer.check()?;
            }
            let sess = match connect(&mat) {
                Ok(sess) => sess,
                Err(e) if attempts < SFTP_TRANSFER_RETRIES && stale_app_error(&e) => {
                    attempts += 1;
                    emit_transfer_progress(app, transfer_id, "重连后重新下载压缩包", 0, None);
                    std::thread::sleep(Duration::from_millis(250));
                    continue;
                }
                Err(e) => return Err(e),
            };

            let result: AppResult<()> = {
                sess.set_blocking(true);
                sess.set_timeout(0);
                let mut channel = sess.channel_session()?;
                channel.exec(&cmd)?;

                let mut local_file = OpenOptions::new()
                    .create(true)
                    .write(true)
                    .truncate(true)
                    .open(local_archive)?;
                let mut buf = [0u8; SFTP_TRANSFER_BUFFER_SIZE];
                let mut transferred = 0u64;
                let mut last_emit = Instant::now();

                emit_transfer_progress(app, transfer_id, "下载压缩包中", 0, None);
                loop {
                    if let Some(transfer) = transfer {
                        transfer.check()?;
                    }
                    let n = channel.read(&mut buf)?;
                    if n == 0 {
                        break;
                    }
                    local_file.write_all(&buf[..n])?;
                    transferred += n as u64;
                    if last_emit.elapsed() >= Duration::from_millis(120) {
                        emit_transfer_progress(app, transfer_id, "下载压缩包中", transferred, None);
                        last_emit = Instant::now();
                    }
                }
                local_file.flush()?;

                if let Some(transfer) = transfer {
                    transfer.check()?;
                }

                channel.wait_close()?;
                let code = channel.exit_status()?;
                if code != 0 {
                    let stderr = self
                        .exec(
                            session_id,
                            &format!(
                                "cat {}; rm -f {}",
                                shell_quote(&remote_stderr),
                                shell_quote(&remote_stderr)
                            ),
                        )
                        .map(|(_, stdout, _)| stdout)
                        .unwrap_or_else(|_| String::new());
                    let msg = if stderr.trim().is_empty() {
                        "tar failed".to_string()
                    } else {
                        stderr.trim().to_string()
                    };
                    return Err(AppError(format!("远端命令失败 (exit {code}): {msg}")));
                }

                let _ = self.exec(
                    session_id,
                    &format!("rm -f {}", shell_quote(&remote_stderr)),
                );
                emit_transfer_progress(app, transfer_id, "下载压缩包中", transferred, None);
                Ok(())
            };

            match result {
                Ok(()) => return Ok(()),
                Err(e) if attempts < SFTP_TRANSFER_RETRIES && stale_app_error(&e) => {
                    attempts += 1;
                    let _ = std::fs::remove_file(local_archive);
                    let _ = self.exec(
                        session_id,
                        &format!("rm -f {}", shell_quote(&remote_stderr)),
                    );
                    emit_transfer_progress(app, transfer_id, "重连后重新下载压缩包", 0, None);
                    std::thread::sleep(Duration::from_millis(250));
                }
                Err(e) => {
                    let _ = self.exec(
                        session_id,
                        &format!("rm -f {}", shell_quote(&remote_stderr)),
                    );
                    if transfer_cancelled_error(&e) {
                        let _ = std::fs::remove_file(local_archive);
                    }
                    return Err(e);
                }
            }
        }
    }

    fn sftp_download_dir_archive(
        &self,
        session_id: &str,
        remote_dir: &str,
        local_dir: &str,
        app: Option<&AppHandle>,
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
                app,
                transfer_id,
                transfer.as_ref(),
            )
            .and_then(|_| {
                if let Some(transfer) = &transfer {
                    transfer.check()?;
                }
                emit_transfer_progress(app, transfer_id, "本地解压中", 0, None);
                extract_clean_tar_gz(&local_archive, Path::new(local_dir), transfer.as_ref())
            });
        result
    }
}
