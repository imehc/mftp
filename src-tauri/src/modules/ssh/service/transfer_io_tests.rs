use super::super::types::Manager;
use super::*;
use crate::error::AppErrorKind;
use std::io::{self, Cursor};
use std::sync::Arc;

struct ShortReader {
    inner: Cursor<Vec<u8>>,
    interrupt: bool,
    failure: Option<AppError>,
}

impl Read for ShortReader {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        if std::mem::take(&mut self.interrupt) {
            return Err(io::ErrorKind::Interrupted.into());
        }
        if let Some(error) = self.failure.take() {
            return Err(io::Error::other(error));
        }
        let len = buffer.len().min(3);
        self.inner.read(&mut buffer[..len])
    }
}

#[derive(Default)]
struct ShortWriter {
    bytes: Vec<u8>,
    interrupt: bool,
    failure_after: Option<usize>,
    zero_after: Option<usize>,
    flush_error: Option<AppError>,
    on_write: Option<Box<dyn FnMut()>>,
    flushes: usize,
}

impl Write for ShortWriter {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        if std::mem::take(&mut self.interrupt) {
            return Err(io::ErrorKind::Interrupted.into());
        }
        if self
            .failure_after
            .is_some_and(|limit| self.bytes.len() >= limit)
        {
            return Err(io::Error::other(timeout()));
        }
        if self
            .zero_after
            .is_some_and(|limit| self.bytes.len() >= limit)
        {
            return Ok(0);
        }
        let count = buffer.len().min(2);
        self.bytes.extend_from_slice(&buffer[..count]);
        if let Some(callback) = &mut self.on_write {
            callback();
        }
        Ok(count)
    }
    fn flush(&mut self) -> io::Result<()> {
        self.flushes += 1;
        match &self.flush_error {
            Some(error) => Err(io::Error::other(error.clone())),
            None => Ok(()),
        }
    }
}

fn timeout() -> AppError {
    AppError::external("io:timed_out", "test IO timeout").with_arg("sourceCode", 42)
}

fn reader(data: &[u8]) -> ShortReader {
    ShortReader {
        inner: Cursor::new(data.to_vec()),
        interrupt: true,
        failure: None,
    }
}

#[test]
fn downloads_handle_short_reads_partial_local_writes_and_interrupts() {
    for data in [
        Vec::new(),
        b"short reads are not EOF".to_vec(),
        vec![7; SFTP_TRANSFER_BUFFER_SIZE + 9],
    ] {
        let mut source = reader(&data);
        let mut target = ShortWriter {
            interrupt: true,
            ..Default::default()
        };
        let mut total = 0;
        let outcome = copy_download(
            &mut source,
            &mut target,
            None,
            |count| total += count,
            || {},
        )
        .unwrap();
        assert_eq!(outcome, TransferIoOutcome::Complete);
        assert_eq!(target.bytes, data);
        assert_eq!(total, data.len());
        assert_eq!(target.flushes, 1);
    }
}

#[test]
fn uploads_handle_short_local_reads_and_partial_remote_writes() {
    let data = vec![13; SFTP_TRANSFER_BUFFER_SIZE + 11];
    let mut source = reader(&data);
    let mut target = ShortWriter {
        interrupt: true,
        ..Default::default()
    };
    let mut total = 0;
    assert_eq!(
        copy_upload(
            &mut source,
            &mut target,
            None,
            |count| total += count,
            || {}
        )
        .unwrap(),
        TransferIoOutcome::Complete
    );
    assert_eq!(target.bytes, data);
    assert_eq!(total, data.len());
    assert_eq!(target.flushes, 1);
}

#[test]
fn identical_local_and_remote_errors_keep_payload_but_have_distinct_retry_policy() {
    let mut local_source = reader(b"data");
    local_source.failure = Some(timeout());
    let error = copy_upload(&mut local_source, &mut Vec::new(), None, |_| {}, || {}).unwrap_err();
    assert!(!error.reconnect());
    assert_eq!(error.into_error(), timeout());
    let mut remote_source = reader(b"data");
    remote_source.failure = Some(timeout());
    let error =
        copy_download(&mut remote_source, &mut Vec::new(), None, |_| {}, || {}).unwrap_err();
    assert!(error.reconnect());
    assert_eq!(error.into_error(), timeout());
    for upload in [false, true] {
        let mut target = ShortWriter {
            failure_after: Some(2),
            ..Default::default()
        };
        let mut count = 0;
        let error = if upload {
            copy_upload(
                &mut Cursor::new(b"abcdef"),
                &mut target,
                None,
                |n| count += n,
                || {},
            )
        } else {
            copy_download(
                &mut Cursor::new(b"abcdef"),
                &mut target,
                None,
                |n| count += n,
                || {},
            )
        }
        .unwrap_err();
        assert_eq!(error.reconnect(), upload);
        assert_eq!(error.into_error(), timeout());
        assert_eq!(target.bytes, b"ab");
        // Only the upload loop reports a known partial remote write. A failed
        // local write ends the operation, without advancing its resume offset.
        assert_eq!(count, if upload { 2 } else { 0 });
    }
}

#[test]
fn flush_errors_keep_the_correct_side_of_the_transfer() {
    for upload in [false, true] {
        let mut target = ShortWriter {
            flush_error: Some(timeout()),
            ..Default::default()
        };
        let error = if upload {
            copy_upload(&mut Cursor::new(b""), &mut target, None, |_| {}, || {})
        } else {
            copy_download(&mut Cursor::new(b""), &mut target, None, |_| {}, || {})
        }
        .unwrap_err();
        assert_eq!(error.reconnect(), upload);
        assert_eq!(error.into_error(), timeout());
    }
}

#[test]
fn zero_writes_stop_at_the_stall_deadline_with_partial_count() {
    for prefix in [0, 2] {
        let mut target = ShortWriter {
            zero_after: Some(prefix),
            ..Default::default()
        };
        match write_buffer(&mut target, b"abcdef", || {}, None, Duration::ZERO) {
            SftpWriteOutcome::Failed { written, error } => {
                assert_eq!(written, prefix);
                assert_eq!(error, AppError::custom(CustomErrorCode::SftpWriteStalled));
            }
            outcome => panic!("unexpected write outcome: {outcome:?}"),
        }
    }
}

#[test]
fn pause_or_cancel_between_partial_writes_stops_before_the_next_write() {
    for cancel in [false, true] {
        let manager = Arc::new(Manager::new(
            std::env::temp_dir().join(format!("mftp-io-{}.json", uuid::Uuid::new_v4())),
        ));
        let transfer = manager.transfer_guard(Some("task")).unwrap();
        let controller = manager.clone();
        let mut target = ShortWriter {
            on_write: Some(Box::new(move || {
                if cancel {
                    controller.cancel_transfer("task");
                } else {
                    controller.pause_transfer("task").unwrap();
                }
            })),
            ..Default::default()
        };
        let mut count = 0;
        let result = copy_upload(
            &mut Cursor::new(b"abcdef"),
            &mut target,
            Some(&transfer),
            |n| count += n,
            || {},
        );
        if cancel {
            let error = result.unwrap_err();
            assert!(!error.reconnect());
            assert_eq!(
                error.into_error(),
                AppError::custom(CustomErrorCode::SftpTransferCancelled)
            );
        } else {
            assert_eq!(result.unwrap(), TransferIoOutcome::Paused);
            assert_eq!(target.flushes, 1);
        }
        assert_eq!(target.bytes, b"ab");
        assert_eq!(count, 2);
    }
}

#[test]
fn premature_eof_is_a_size_error_and_unknown_or_empty_sizes_remain_valid() {
    let mut target = Vec::new();
    copy_download(&mut Cursor::new(b"short"), &mut target, None, |_| {}, || {}).unwrap();
    let error = verify_size(target.len() as u64, Some(10), "target").unwrap_err();
    assert_eq!(error.kind, AppErrorKind::Custom);
    assert_eq!(error.code, CustomErrorCode::SftpSizeMismatch.as_str());
    assert_eq!(error.args["actual"], "5");
    assert_eq!(error.args["expected"], "10");
    assert_eq!(error.args["path"], "target");
    verify_size(0, Some(0), "empty").unwrap();
    verify_size(5, None, "unknown").unwrap();
}

struct DisconnectingReader {
    inner: Cursor<Vec<u8>>,
    remaining: usize,
}
impl Read for DisconnectingReader {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        if self.remaining == 0 {
            return Err(io::Error::other(timeout()));
        }
        let count = buffer.len().min(self.remaining);
        let count = self.inner.read(&mut buffer[..count])?;
        self.remaining -= count;
        Ok(count)
    }
}
impl Seek for DisconnectingReader {
    fn seek(&mut self, position: SeekFrom) -> io::Result<u64> {
        self.inner.seek(position)
    }
}

#[test]
fn download_reopens_at_confirmed_offset_without_repeating_or_skipping_bytes() {
    let data = b"abcdef0123456789";
    let mut local = Cursor::new(Vec::new());
    let mut first = DisconnectingReader {
        inner: Cursor::new(data.to_vec()),
        remaining: 5,
    };
    let mut confirmed = 0;
    seek_transfer(&mut local, &mut first, confirmed).unwrap();
    let error = copy_download(
        &mut first,
        &mut local,
        None,
        |count| confirmed += count as u64,
        || {},
    )
    .unwrap_err();
    assert!(error.reconnect());
    assert_eq!(confirmed, 5);
    let mut reconnected = Cursor::new(data);
    seek_transfer(&mut local, &mut reconnected, confirmed).unwrap();
    copy_download(
        &mut reconnected,
        &mut local,
        None,
        |count| confirmed += count as u64,
        || {},
    )
    .unwrap();
    assert_eq!(local.into_inner(), data);
    assert_eq!(confirmed, data.len() as u64);
}

struct AmbiguousWriter(Cursor<Vec<u8>>);
impl Write for AmbiguousWriter {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        // Model a peer committing a prefix before the acknowledgement is lost.
        self.0.write_all(&buffer[..buffer.len().min(3)])?;
        Err(io::Error::other(timeout()))
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
impl Seek for AmbiguousWriter {
    fn seek(&mut self, position: SeekFrom) -> io::Result<u64> {
        self.0.seek(position)
    }
}

#[test]
fn upload_resumes_from_peer_size_after_an_ambiguous_write() {
    let data = b"abcdef0123456789";
    let mut local = Cursor::new(data);
    let mut first = AmbiguousWriter(Cursor::new(Vec::new()));
    let mut reported = 0;
    seek_transfer(&mut local, &mut first, 0).unwrap();
    let error = copy_upload(
        &mut local,
        &mut first,
        None,
        |count| reported += count,
        || {},
    )
    .unwrap_err();
    assert!(error.reconnect());
    assert_eq!(reported, 0);
    let peer_size = first.0.get_ref().len() as u64;
    assert_eq!(peer_size, 3);
    let mut reconnected = first.0;
    seek_transfer(&mut local, &mut reconnected, peer_size).unwrap();
    copy_upload(&mut local, &mut reconnected, None, |_| {}, || {}).unwrap();
    verify_size(
        reconnected.get_ref().len() as u64,
        Some(data.len() as u64),
        "remote",
    )
    .unwrap();
    assert_eq!(reconnected.into_inner(), data);
}

struct FailedSeek;
impl Seek for FailedSeek {
    fn seek(&mut self, _: SeekFrom) -> io::Result<u64> {
        Err(io::Error::other(timeout()))
    }
}

#[test]
fn seek_failures_also_keep_local_and_remote_origin() {
    let error = seek_transfer(&mut FailedSeek, &mut Cursor::new(b""), 0).unwrap_err();
    assert!(!error.reconnect());
    assert_eq!(error.into_error(), timeout());
    let error = seek_transfer(&mut Cursor::new(b""), &mut FailedSeek, 0).unwrap_err();
    assert!(error.reconnect());
    assert_eq!(error.into_error(), timeout());
}
