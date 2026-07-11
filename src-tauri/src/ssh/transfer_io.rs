enum SftpWriteOutcome {
    Complete { written: usize },
    Paused { written: usize },
    Failed { written: usize, error: AppError },
}

fn transfer_retry_delay(attempt: usize) -> Duration {
    let exponent = attempt.saturating_sub(1).min(4) as u32;
    Duration::from_millis(250u64.saturating_mul(2u64.pow(exponent)))
}

fn write_sftp_buffer(
    remote_file: &mut ssh2::File,
    buffer: &[u8],
    session: &Session,
    transfer: Option<&TransferGuard>,
) -> SftpWriteOutcome {
    let mut written = 0usize;
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

        match remote_file.write(&buffer[written..]) {
            Ok(0) => {
                if stalled_since.elapsed() >= Duration::from_secs(SFTP_WRITE_STALL_TIMEOUT_SECS) {
                    return SftpWriteOutcome::Failed {
                        written,
                        error: AppError("SFTP write stalled while waiting for socket capacity".into()),
                    };
                }
                if last_keepalive.elapsed() >= Duration::from_secs(SFTP_TRANSFER_KEEPALIVE_SECS) {
                    let _ = session.keepalive_send();
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
