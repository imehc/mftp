use crate::error::{AppError, AppErrorKind, CustomErrorCode};

pub(super) fn stale_session_error(error: &ssh2::Error) -> bool {
    stale_app_error(&AppError::from_ssh(error))
}

pub(super) fn stale_app_error(error: &AppError) -> bool {
    match error.kind {
        AppErrorKind::Custom => error.code == CustomErrorCode::SftpWriteStalled.as_str(),
        // ssh2 can erase the numeric code when converting Read/Write failures
        // into io::Error. Unknown IO errors stay non-retryable: message text
        // and a potentially stale session error cannot establish their source.
        AppErrorKind::External => matches!(
            error.code.as_str(),
            "ssh:timed_out"
                | "ssh:disconnected"
                | "ssh:would_block"
                | "io:timed_out"
                | "io:connection_reset"
                | "io:connection_aborted"
                | "io:not_connected"
                | "io:broken_pipe"
                | "io:would_block"
        ),
    }
}

#[cfg(test)]
#[path = "errors_tests.rs"]
mod tests;
