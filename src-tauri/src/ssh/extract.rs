impl Manager {
    /// Extract a remote archive into `remote_parent`.
    ///
    /// When `out_name` is `Some`, the archive is extracted into a temporary
    /// staging dir first, then placed as a single directory named `out_name`
    /// (a lone top-level dir is unwrapped/renamed; multiple entries are wrapped).
    /// This makes the result name predictable and lets the caller rename it.
    /// When `None`, the archive is extracted directly with its natural names.
    pub fn sftp_extract(
        &self,
        session_id: &str,
        remote_archive: &str,
        remote_parent: &str,
        out_name: Option<&str>,
    ) -> AppResult<()> {
        let out_name = match out_name {
            None => {
                let cmd = extract_cmd(remote_archive, remote_parent)?;
                return self.exec_checked(session_id, &cmd).map(|_| ());
            }
            Some(n) => n,
        };

        let staging = join_remote(remote_parent, &format!(".mftp-x-{}", uuid_v4()));
        self.exec_checked(session_id, &format!("mkdir -p {}", shell_quote(&staging)))?;

        // Extract into the staging dir; clean up staging on any failure.
        let cmd = match extract_cmd(remote_archive, &staging) {
            Ok(c) => c,
            Err(e) => {
                let _ = self.exec(session_id, &format!("rm -rf {}", shell_quote(&staging)));
                return Err(e);
            }
        };
        if let Err(e) = self.exec_checked(session_id, &cmd) {
            let _ = self.exec(session_id, &format!("rm -rf {}", shell_quote(&staging)));
            return Err(e);
        }

        // Inspect the staging dir's top-level entries.
        let (_, listing, _) =
            self.exec(session_id, &format!("ls -1A {}", shell_quote(&staging)))?;
        let entries: Vec<&str> = listing.lines().filter(|l| !l.is_empty()).collect();
        let target = join_remote(remote_parent, out_name);

        let result = if entries.len() == 1 {
            // Single top entry: move it to the target name (unwrap/rename).
            let only = join_remote(&staging, entries[0]);
            self.exec_checked(
                session_id,
                &format!("mv {} {}", shell_quote(&only), shell_quote(&target)),
            )
            .map(|_| ())
        } else {
            // Multiple/zero entries: wrap the staging dir itself as the target.
            self.exec_checked(
                session_id,
                &format!("mv {} {}", shell_quote(&staging), shell_quote(&target)),
            )
            .map(|_| ())
        };

        // Remove staging if it still exists (it's gone when wrapped by mv).
        let _ = self.exec(session_id, &format!("rm -rf {}", shell_quote(&staging)));
        result
    }
}
