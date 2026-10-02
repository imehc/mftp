use super::errors::stale_app_error;
use super::path_utils::{extract_cmd, join_remote, shell_quote, uuid_v4};
use super::types::Manager;
use crate::error::AppResult;

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
                let marker = join_remote(remote_parent, &format!(".mftp-x-{}.done", uuid_v4()));
                let _marker = self.create_remote_temp_file(session_id, &marker)?;
                let command = format!("{cmd} && printf 1 > {}", shell_quote(&marker));
                return match self.exec_checked(session_id, &command) {
                    Ok(_) => Ok(()),
                    Err(error) if stale_app_error(&error) => {
                        if self.confirm_remote_command_marker(session_id, &marker, None)? {
                            Ok(())
                        } else {
                            Err(error)
                        }
                    }
                    Err(error) => Err(error),
                };
            }
            Some(n) => n,
        };

        let staging = join_remote(remote_parent, &format!(".mftp-x-{}", uuid_v4()));
        let mut staging_guard = self.create_remote_temp_dir(session_id, &staging)?;

        let cmd = extract_cmd(remote_archive, &staging)?;
        let marker = join_remote(remote_parent, &format!(".mftp-x-{}.done", uuid_v4()));
        let _marker = self.create_remote_temp_file(session_id, &marker)?;
        let command = format!("{cmd} && printf 1 > {}", shell_quote(&marker));
        match self.exec_checked(session_id, &command) {
            Ok(_) => {}
            Err(error) if stale_app_error(&error) => {
                if !self.confirm_remote_command_marker(session_id, &marker, None)? {
                    return Err(error);
                }
            }
            Err(error) => return Err(error),
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

        if result.is_ok() && entries.len() != 1 {
            // The staging directory itself became the published target. Its
            // guard must not remove the user's completed extraction.
            staging_guard.disarm();
        }
        result
    }
}
