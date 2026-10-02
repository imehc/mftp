use super::errors::stale_app_error;
use super::types::{TransferGuard, TransferIoOutcome};
use crate::error::{AppError, AppResult};
use std::time::Duration;

pub(super) const SFTP_TRANSFER_RETRIES: usize = 10;

// Origin is an internal retry decision, never a second wire error protocol.
// A local disk timeout must not invalidate SSH or replay a remote write.
#[derive(Debug)]
pub(super) enum AttemptError {
    Remote(AppError),
    Local(AppError),
}

impl AttemptError {
    pub(super) fn remote(error: impl Into<AppError>) -> Self {
        Self::Remote(error.into())
    }

    pub(super) fn local(error: impl Into<AppError>) -> Self {
        Self::Local(error.into())
    }

    pub(super) fn reconnect(&self) -> bool {
        matches!(self, Self::Remote(error) if stale_app_error(error))
    }

    pub(super) fn into_error(self) -> AppError {
        match self {
            Self::Remote(error) | Self::Local(error) => error,
        }
    }
}

pub(super) type AttemptResult<T> = Result<T, AttemptError>;

pub(super) fn transfer_retry_delay(attempt: usize) -> Duration {
    let exponent = attempt.saturating_sub(1).min(4) as u32;
    Duration::from_millis(250u64.saturating_mul(2u64.pow(exponent)))
}

pub(super) fn run_transfer<C>(
    transfer: Option<&TransferGuard>,
    connect: impl FnMut() -> AppResult<C>,
    attempt: impl FnMut(&C) -> AttemptResult<TransferIoOutcome>,
    invalidate: impl FnMut(&C),
    retrying: impl FnMut(usize),
) -> AppResult<()> {
    run_with_wait(transfer, connect, attempt, invalidate, retrying, |delay| {
        if let Some(transfer) = transfer {
            transfer.wait_retry(delay)
        } else {
            std::thread::sleep(delay);
            Ok(())
        }
    })
}

fn run_with_wait<C>(
    transfer: Option<&TransferGuard>,
    mut connect: impl FnMut() -> AppResult<C>,
    mut attempt: impl FnMut(&C) -> AttemptResult<TransferIoOutcome>,
    mut invalidate: impl FnMut(&C),
    mut retrying: impl FnMut(usize),
    mut wait: impl FnMut(Duration) -> AppResult<()>,
) -> AppResult<()> {
    // A finite per-file budget also bounds repeated failures after short bursts
    // of progress. Pausing neither consumes nor resets that budget.
    let mut retries = 0;
    loop {
        if let Some(transfer) = transfer {
            transfer.check()?;
        }
        let result = match connect() {
            Ok(connection) => {
                // The closure is the actual ?/return boundary. Its lock and
                // stream handles are dropped before invalidation or waiting.
                let result = attempt(&connection);
                if result.as_ref().is_err_and(AttemptError::reconnect) {
                    invalidate(&connection);
                }
                result
            }
            Err(error) => Err(AttemptError::remote(error)),
        };
        match result {
            Ok(TransferIoOutcome::Complete) => {
                if let Some(transfer) = transfer {
                    transfer.check()?;
                }
                return Ok(());
            }
            Ok(TransferIoOutcome::Paused) => continue,
            Err(error) if error.reconnect() && retries < SFTP_TRANSFER_RETRIES => {
                retries += 1;
                retrying(retries);
                wait(transfer_retry_delay(retries))?;
            }
            Err(error) => return Err(error.into_error()),
        }
    }
}

#[cfg(test)]
#[path = "transfer_retry_tests.rs"]
mod tests;
