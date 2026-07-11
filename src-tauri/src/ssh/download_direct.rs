impl Manager {
    /// Download a remote directory recursively over SFTP.
    fn sftp_download_dir_direct(
        &self,
        session_id: &str,
        remote_dir: &str,
        local_dir: &str,
        app: Option<&AppHandle>,
        transfer_id: Option<&str>,
    ) -> AppResult<()> {
        let transfer = self.transfer_guard(transfer_id);
        emit_transfer_progress(app, transfer_id, "扫描中", 0, None);
        if let Some(transfer) = &transfer {
            transfer.check()?;
        }
        let plan = self.build_download_plan(session_id, remote_dir, local_dir)?;
        if let Some(transfer) = &transfer {
            transfer.check()?;
        }

        let total = plan.total_file_bytes;
        let total_for_progress = if total == 0 { Some(1) } else { Some(total) };
        let mut downloaded = 0u64;
        let mut last_emit = Instant::now();
        emit_transfer_progress(app, transfer_id, "创建目录中", 0, total_for_progress);

        for entry in plan.entries {
            if let Some(transfer) = &transfer {
                transfer.check()?;
            }

            match entry.kind {
                DownloadEntryKind::Directory => {
                    std::fs::create_dir_all(&entry.local)?;
                    if last_emit.elapsed() >= Duration::from_millis(120) {
                        emit_transfer_progress(
                            app,
                            transfer_id,
                            "下载文件夹中",
                            downloaded,
                            total_for_progress,
                        );
                        last_emit = Instant::now();
                    }
                }
                DownloadEntryKind::File { size } => {
                    if let Some(parent) = entry.local.parent() {
                        std::fs::create_dir_all(parent)?;
                    }
                    let temp_local = local_temp_sibling(&entry.local);
                    let _temp_cleanup = self.track_local_temp(temp_local.clone())?;
                    let download_res = self.download_remote_file_to_local(
                        session_id,
                        &entry.remote,
                        &temp_local,
                        size,
                        app,
                        transfer_id,
                        "下载文件夹中",
                        downloaded,
                        total,
                        transfer.as_ref(),
                    );
                    if let Err(e) = download_res {
                        let _ = std::fs::remove_file(&temp_local);
                        return Err(e);
                    }
                    if let Err(e) = rename_local_file_overwrite(&temp_local, &entry.local) {
                        let _ = std::fs::remove_file(&temp_local);
                        return Err(e);
                    }
                    downloaded = downloaded.saturating_add(size);
                    if last_emit.elapsed() >= Duration::from_millis(120) || downloaded >= total {
                        emit_transfer_progress(
                            app,
                            transfer_id,
                            "下载文件夹中",
                            downloaded,
                            total_for_progress,
                        );
                        last_emit = Instant::now();
                    }
                }
                DownloadEntryKind::Symlink { target } => {
                    if let Some(parent) = entry.local.parent() {
                        std::fs::create_dir_all(parent)?;
                    }
                    create_local_symlink_overwrite(&target, &entry.local)?;
                    if last_emit.elapsed() >= Duration::from_millis(120) {
                        emit_transfer_progress(
                            app,
                            transfer_id,
                            "下载文件夹中",
                            downloaded,
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
