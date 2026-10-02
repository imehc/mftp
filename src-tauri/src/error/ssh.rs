use super::AppError;

impl AppError {
    pub(crate) fn from_ssh(error: &ssh2::Error) -> Self {
        let (code, source, number) = match error.code() {
            // libssh2 numeric transport/authentication constants, not message text.
            ssh2::ErrorCode::Session(number) => (
                match number {
                    -9 | -30 => "ssh:timed_out",
                    -18 => "ssh:authentication_failed",
                    -7 | -13 | -43 | -45 => "ssh:disconnected",
                    -37 => "ssh:would_block",
                    _ => "ssh:session",
                },
                "session",
                number,
            ),
            ssh2::ErrorCode::SFTP(number) => (
                match number {
                    // SSH_FX_NO_CONNECTION / SSH_FX_CONNECTION_LOST.
                    6 | 7 => "ssh:disconnected",
                    _ => "ssh:sftp",
                },
                "sftp",
                number,
            ),
        };
        Self::external(code, error.to_string())
            .with_arg("source", source)
            .with_arg("sourceCode", number)
    }

    pub(crate) fn ssh_invalid_response(diagnostic: &'static str) -> Self {
        Self::external("ssh:invalid_response", diagnostic)
    }

    pub(crate) fn ssh_remote_exit(exit_code: i32, diagnostic: &str) -> Self {
        // Keep the remote tool's diagnostic, never attach the executed command
        // or authentication inputs. Bound untrusted output on the IPC boundary.
        let diagnostic: String = diagnostic.trim().chars().take(4096).collect();
        Self::external(
            "ssh:remote_exit",
            if diagnostic.is_empty() {
                "Remote command failed".to_owned()
            } else {
                diagnostic
            },
        )
        .with_arg("exitCode", exit_code)
    }
}

impl From<ssh2::Error> for AppError {
    fn from(error: ssh2::Error) -> Self {
        Self::from_ssh(&error)
    }
}

#[cfg(test)]
#[path = "ssh_tests.rs"]
mod tests;
