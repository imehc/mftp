use super::transfer_retry::{AttemptError, AttemptResult};
use super::types::{TransferGuard, TransferIoOutcome};
use crate::error::{AppError, AppResult, CustomErrorCode};
use std::io::{Read, Seek, SeekFrom, Write};
use std::time::{Duration, Instant};

const SFTP_WRITE_STALL_TIMEOUT: Duration = Duration::from_secs(5);
const SFTP_TRANSFER_KEEPALIVE: Duration = Duration::from_secs(5);
pub(super) const SFTP_TRANSFER_BUFFER_SIZE: usize = 64 * 1024;

#[derive(Debug)]
pub(super) enum SftpWriteOutcome {
    Complete { written: usize },
    Paused { written: usize },
    Failed { written: usize, error: AppError },
}

pub(super) fn verify_size(actual: u64, expected: Option<u64>, path: &str) -> AppResult<()> {
    if let Some(expected) = expected.filter(|expected| *expected != actual) {
        return Err(AppError::custom(CustomErrorCode::SftpSizeMismatch)
            .with_arg("actual", actual)
            .with_arg("expected", expected)
            .with_arg("path", path));
    }
    Ok(())
}

pub(super) fn seek_transfer(
    local: &mut impl Seek,
    remote: &mut impl Seek,
    offset: u64,
) -> AttemptResult<()> {
    local
        .seek(SeekFrom::Start(offset))
        .map_err(AttemptError::local)?;
    remote
        .seek(SeekFrom::Start(offset))
        .map_err(AttemptError::remote)?;
    Ok(())
}

// A short read is not EOF. Count only bytes successfully stored locally;
// partial local writes terminate the task and are never retried as SSH errors.
pub(super) fn copy_download(
    remote: &mut impl Read,
    local: &mut impl Write,
    transfer: Option<&TransferGuard>,
    mut progress: impl FnMut(usize),
    mut keepalive: impl FnMut(),
) -> AttemptResult<TransferIoOutcome> {
    let mut buffer = [0; SFTP_TRANSFER_BUFFER_SIZE];
    let mut last_keepalive = Instant::now();
    loop {
        if let Some(transfer) = transfer {
            if transfer.io_paused().map_err(AttemptError::local)? {
                local.flush().map_err(AttemptError::local)?;
                return Ok(TransferIoOutcome::Paused);
            }
        }
        let count = match remote.read(&mut buffer) {
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            result => result.map_err(AttemptError::remote)?,
        };
        if count == 0 {
            local.flush().map_err(AttemptError::local)?;
            return Ok(TransferIoOutcome::Complete);
        }
        local
            .write_all(&buffer[..count])
            .map_err(AttemptError::local)?;
        progress(count);
        if last_keepalive.elapsed() >= SFTP_TRANSFER_KEEPALIVE {
            keepalive();
            last_keepalive = Instant::now();
        }
    }
}

pub(super) fn copy_upload(
    local: &mut impl Read,
    remote: &mut impl Write,
    transfer: Option<&TransferGuard>,
    mut progress: impl FnMut(usize),
    mut keepalive: impl FnMut(),
) -> AttemptResult<TransferIoOutcome> {
    let mut buffer = [0; SFTP_TRANSFER_BUFFER_SIZE];
    loop {
        if let Some(transfer) = transfer {
            if transfer.io_paused().map_err(AttemptError::local)? {
                remote.flush().map_err(AttemptError::remote)?;
                return Ok(TransferIoOutcome::Paused);
            }
        }
        let count = match local.read(&mut buffer) {
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            result => result.map_err(AttemptError::local)?,
        };
        if count == 0 {
            remote.flush().map_err(AttemptError::remote)?;
            return Ok(TransferIoOutcome::Complete);
        }
        let outcome = write_sftp_buffer(remote, &buffer[..count], &mut keepalive, transfer);
        match outcome {
            SftpWriteOutcome::Complete { written } => progress(written),
            SftpWriteOutcome::Paused { written } => {
                progress(written);
                remote.flush().map_err(AttemptError::remote)?;
                return Ok(TransferIoOutcome::Paused);
            }
            SftpWriteOutcome::Failed { written, error } => {
                progress(written);
                return Err(AttemptError::remote(error));
            }
        }
    }
}

pub(super) fn write_sftp_buffer(
    remote: &mut impl Write,
    buffer: &[u8],
    keepalive: impl FnMut(),
    transfer: Option<&TransferGuard>,
) -> SftpWriteOutcome {
    write_buffer(
        remote,
        buffer,
        keepalive,
        transfer,
        SFTP_WRITE_STALL_TIMEOUT,
    )
}

fn write_buffer(
    remote: &mut impl Write,
    buffer: &[u8],
    mut keepalive: impl FnMut(),
    transfer: Option<&TransferGuard>,
    stall_timeout: Duration,
) -> SftpWriteOutcome {
    let mut written = 0;
    let mut stalled_since = Instant::now();
    let mut last_keepalive = Instant::now();
    while written < buffer.len() {
        if let Some(transfer) = transfer {
            match transfer.io_paused() {
                Ok(true) => return SftpWriteOutcome::Paused { written },
                Ok(false) => {}
                Err(error) => return SftpWriteOutcome::Failed { written, error },
            }
        }
        match remote.write(&buffer[written..]) {
            Ok(0) => {
                if stalled_since.elapsed() >= stall_timeout {
                    return SftpWriteOutcome::Failed {
                        written,
                        error: AppError::custom(CustomErrorCode::SftpWriteStalled),
                    };
                }
                if last_keepalive.elapsed() >= SFTP_TRANSFER_KEEPALIVE {
                    keepalive();
                    last_keepalive = Instant::now();
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            Ok(count) => {
                written += count;
                stalled_since = Instant::now();
            }
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
            Err(error) => {
                return SftpWriteOutcome::Failed {
                    written,
                    error: error.into(),
                }
            }
        }
    }
    SftpWriteOutcome::Complete { written }
}

#[cfg(test)]
#[path = "transfer_io_tests.rs"]
mod tests;
