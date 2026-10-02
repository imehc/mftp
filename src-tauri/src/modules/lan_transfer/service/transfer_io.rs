use super::tasks::SharedTasks;
use crate::error::{AppError, CustomErrorCode};
use std::io::{Read, Write};

pub(super) fn copy_body(
    input: &mut impl Read,
    output: &mut impl Write,
    length: u64,
    tasks: &SharedTasks,
    task_id: &str,
) -> std::io::Result<()> {
    use std::io::{Error, ErrorKind};
    let mut sent = 0u64;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        if super::tasks::task_is_canceled(tasks, task_id) {
            // Interrupted is retried by IO consumers; cancellation must be terminal.
            return Err(Error::other(AppError::custom(
                CustomErrorCode::LanTransferCancelled,
            )));
        }
        if sent == length {
            return Ok(());
        }
        let want = (length - sent).min(buffer.len() as u64) as usize;
        let count = match input.read(&mut buffer[..want]) {
            Err(error) if error.kind() == ErrorKind::Interrupted => continue,
            result => result?,
        };
        if count == 0 {
            return Err(Error::new(
                ErrorKind::UnexpectedEof,
                "Transfer source ended before Content-Length",
            ));
        }
        let mut written = 0;
        while written < count {
            if super::tasks::task_is_canceled(tasks, task_id) {
                return Err(Error::other(AppError::custom(
                    CustomErrorCode::LanTransferCancelled,
                )));
            }
            match output.write(&buffer[written..count]) {
                Ok(0) => {
                    return Err(Error::new(
                        ErrorKind::WriteZero,
                        "Transfer destination made no write progress",
                    ))
                }
                Ok(count) => {
                    written += count;
                    sent += count as u64;
                    // Count bytes accepted by the socket even if a later write fails.
                    super::tasks::update_task_progress(tasks, task_id, sent);
                }
                Err(error) if error.kind() == ErrorKind::Interrupted => continue,
                Err(error) => return Err(error),
            }
        }
    }
}
