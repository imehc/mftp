impl Manager {
    /// Register auth material under a new/again session id (no I/O yet).
    pub fn register(&self, session_id: &str, mat: AuthMaterial) {
        self.auth.lock().insert(session_id.to_string(), mat);
    }

    fn material(&self, session_id: &str) -> AppResult<AuthMaterial> {
        self.auth
            .lock()
            .get(session_id)
            .cloned()
            .ok_or_else(|| AppError(format!("unknown session: {session_id}")))
    }

    /// Open an interactive shell on a dedicated worker thread.
    pub fn open_shell(
        &self,
        app: AppHandle,
        session_id: &str,
        cols: u32,
        rows: u32,
    ) -> AppResult<()> {
        let mut shells = self.shells.lock();
        if shells.contains_key(session_id) {
            return Ok(()); // already open
        }
        let mat = self.material(session_id)?;
        let sess = connect(&mat)?;

        let mut channel = sess.channel_session()?;
        channel.request_pty("xterm-256color", None, Some((cols, rows, 0, 0)))?;
        channel.shell()?;

        let (tx, rx) = std::sync::mpsc::channel::<ShellJob>();
        shells.insert(session_id.to_string(), ShellHandle { tx });
        drop(shells);

        let id = session_id.to_string();
        std::thread::spawn(move || {
            shell_worker(app, id, sess, channel, rx);
        });
        Ok(())
    }

    pub fn write(&self, session_id: &str, data: &[u8]) -> AppResult<()> {
        let shells = self.shells.lock();
        let handle = shells
            .get(session_id)
            .ok_or_else(|| AppError("shell not open".into()))?;
        handle
            .tx
            .send(ShellJob::Write(data.to_vec()))
            .map_err(|_| AppError("shell closed".into()))
    }

    pub fn resize(&self, session_id: &str, cols: u32, rows: u32) -> AppResult<()> {
        let shells = self.shells.lock();
        if let Some(handle) = shells.get(session_id) {
            let _ = handle.tx.send(ShellJob::Resize(cols, rows));
        }
        Ok(())
    }

    pub fn disconnect(&self, session_id: &str) {
        if let Some(handle) = self.shells.lock().remove(session_id) {
            let _ = handle.tx.send(ShellJob::Close);
        }
        self.sftp.lock().remove(session_id);
        self.auth.lock().remove(session_id);
    }

    pub fn shutdown_all(&self) {
        self.cancel_all_transfers();

        let deadline = Instant::now() + Duration::from_secs(2);
        while !self.transfers.lock().is_empty() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        self.cleanup_local_temps();

        let mut ids: Vec<String> = self.auth.lock().keys().cloned().collect();
        ids.extend(self.shells.lock().keys().cloned());
        ids.sort_unstable();
        ids.dedup();
        for id in ids {
            self.disconnect(&id);
        }
    }
}
