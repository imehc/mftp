//! Bounded, cancellable input for plain and Zstandard transcript files.
use std::fs::File;
use std::io::{self, Read};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use crate::error::{AppError, AppResult, CustomErrorCode};

const MAX_COMPRESSED_BYTES: u64 = 512 * 1024 * 1024;
const MAX_DECODED_BYTES: u64 = 512 * 1024 * 1024;
const MAX_WINDOW_LOG: u32 = 27;
const READ_DEADLINE: Duration = Duration::from_secs(45);

#[derive(Clone, Copy)]
enum Stage {
    Source,
    Decoder,
}

struct GuardedRead<'a, R> {
    inner: R,
    cancel: &'a AtomicBool,
    started: Instant,
    remaining: Option<u64>,
    stage: Stage,
}

fn failure(code: CustomErrorCode) -> io::Error {
    io::Error::other(AppError::custom(code))
}

fn check(cancel: &AtomicBool, started: Instant) -> io::Result<()> {
    if cancel.load(Ordering::Acquire) {
        return Err(failure(CustomErrorCode::AgentSessionCancelled));
    }
    if started.elapsed() > READ_DEADLINE {
        return Err(failure(CustomErrorCode::AgentSessionLimit));
    }
    Ok(())
}

fn decoder_error(error: io::Error) -> io::Error {
    // The source guard wraps IO, cancellation and limits before zstd sees
    // them. Decoder errors alone are format failures; no text matching.
    if error.get_ref().is_some_and(|inner| inner.is::<AppError>()) {
        error
    } else {
        failure(CustomErrorCode::AgentSessionFormat)
    }
}

impl<R: Read> GuardedRead<'_, R> {
    fn read_inner(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        self.inner.read(buffer).map_err(|error| match self.stage {
            Stage::Source => io::Error::other(AppError::from_io(&error)),
            Stage::Decoder => decoder_error(error),
        })
    }
}

impl<R: Read> Read for GuardedRead<'_, R> {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        check(self.cancel, self.started)?;
        if buffer.is_empty() {
            return Ok(0);
        }
        if self.remaining == Some(0) {
            // Permit an exact-budget stream to reach EOF. At most one byte
            // is probed and no byte beyond the budget reaches the consumer.
            let mut probe = [0];
            let count = self.read_inner(&mut probe)?;
            check(self.cancel, self.started)?;
            return if count == 0 {
                Ok(0)
            } else {
                Err(failure(CustomErrorCode::AgentSessionLimit))
            };
        }
        let capacity = self.remaining.map_or(buffer.len(), |remaining| {
            remaining.min(buffer.len() as u64) as usize
        });
        let count = self.read_inner(&mut buffer[..capacity])?;
        check(self.cancel, self.started)?;
        if let Some(remaining) = &mut self.remaining {
            *remaining = remaining.saturating_sub(count as u64);
        }
        Ok(count)
    }
}

pub(super) fn is_compressed(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.ends_with(".jsonl.zst"))
}

fn decode<'a>(
    source: impl Read + 'a,
    cancel: &'a AtomicBool,
    started: Instant,
    decoded_limit: u64,
    window_log: u32,
) -> AppResult<Box<dyn Read + 'a>> {
    // Also guard the compressed source: a decoder can consume skippable
    // frames or many input blocks before returning a decoded byte.
    let source = GuardedRead {
        inner: source,
        cancel,
        started,
        remaining: None,
        stage: Stage::Source,
    };
    let mut decoder = zstd::stream::read::Decoder::new(source)
        .map_err(|error| AppError::from_io(&decoder_error(error)))?;
    decoder
        .window_log_max(window_log)
        .map_err(|error| AppError::from_io(&decoder_error(error)))?;
    // Decoder's default concatenated-frame behavior is intentional. The
    // decoded budget belongs to the entire source, not each frame.
    Ok(Box::new(GuardedRead {
        inner: decoder,
        cancel,
        started,
        remaining: Some(decoded_limit),
        stage: Stage::Decoder,
    }))
}

pub(super) fn open<'a>(
    path: &Path,
    length: Option<u64>,
    cancel: &'a AtomicBool,
) -> AppResult<Box<dyn Read + 'a>> {
    let started = Instant::now();
    check(cancel, started)?;
    let file = File::open(path)?;
    let available = file.metadata()?.len();
    let length = length.unwrap_or(available);
    if length > available {
        return Err(AppError::custom(CustomErrorCode::AgentSessionChanged));
    }
    if is_compressed(path) {
        if available > MAX_COMPRESSED_BYTES {
            return Err(AppError::custom(CustomErrorCode::AgentSessionLimit));
        }
        if length == 0 {
            return Err(AppError::custom(CustomErrorCode::AgentSessionFormat));
        }
        decode(
            file.take(length),
            cancel,
            started,
            MAX_DECODED_BYTES,
            MAX_WINDOW_LOG,
        )
    } else {
        Ok(Box::new(GuardedRead {
            inner: file.take(length),
            cancel,
            started,
            remaining: None,
            stage: Stage::Source,
        }))
    }
}

#[cfg(test)]
pub(super) fn test_decoder<'a>(
    source: impl Read + 'a,
    cancel: &'a AtomicBool,
    decoded_limit: u64,
    window_log: u32,
    started: Instant,
) -> AppResult<Box<dyn Read + 'a>> {
    decode(source, cancel, started, decoded_limit, window_log)
}
