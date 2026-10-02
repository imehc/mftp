use super::*;
use crate::core::http_range::RangeRequest;
use crate::error::{AppError, CustomErrorCode};
use crate::modules::lan_transfer::service::tasks::SharedTasks;
use crate::modules::lan_transfer::service::tests::transfer_tasks;
use std::io::{self, Cursor, ErrorKind};

struct ShortReader {
    source: Cursor<Vec<u8>>,
    interrupted: bool,
}

impl Read for ShortReader {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        if !std::mem::replace(&mut self.interrupted, true) {
            return Err(ErrorKind::Interrupted.into());
        }
        let want = buffer.len().min(3);
        self.source.read(&mut buffer[..want])
    }
}

struct ShortWriter {
    data: Vec<u8>,
    limit: usize,
    interrupted: bool,
    zero: bool,
}

impl Write for ShortWriter {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        if !std::mem::replace(&mut self.interrupted, true) {
            return Err(ErrorKind::Interrupted.into());
        }
        if self.data.len() == self.limit {
            return if self.zero {
                Ok(0)
            } else {
                Err(ErrorKind::BrokenPipe.into())
            };
        }
        let count = buffer.len().min(2).min(self.limit - self.data.len());
        self.data.extend_from_slice(&buffer[..count]);
        Ok(count)
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

#[test]
fn short_reads_writes_and_os_interruptions_preserve_exact_body_bounds() {
    let tasks = transfer_tasks(7);
    let mut input = ShortReader {
        source: Cursor::new(b"0123456789".to_vec()),
        interrupted: false,
    };
    let mut output = ShortWriter {
        data: vec![],
        limit: 20,
        interrupted: false,
        zero: false,
    };
    copy_body(&mut input, &mut output, 7, &tasks, "task").unwrap();
    assert_eq!(output.data, b"0123456");
    assert_eq!(input.source.position(), 7);
    assert_eq!(tasks.lock().rows["task"].transferred, 7);
}

#[test]
fn early_eof_is_failure_with_actual_progress_and_no_second_response() {
    let tasks = transfer_tasks(10);
    let mut output = vec![];
    let result = write_file_range_response(
        &mut output,
        "application/octet-stream",
        &mut Cursor::new(b"short"),
        RangeRequest::Absent.resolve(10).unwrap(),
        10,
        &[],
        &tasks,
        "task",
    );
    let error = super::super::tasks::finish_task(&tasks, "task", result).unwrap_err();
    assert_eq!(error.code, "io:unexpected_eof");
    let output = String::from_utf8(output).unwrap();
    assert!(output.contains("Content-Length: 10\r\n"));
    assert!(output.ends_with("\r\n\r\nshort"));
    assert_eq!(output.matches("HTTP/1.1").count(), 1);
    assert_eq!(tasks.lock().rows["task"].status, "failed");
    assert_eq!(tasks.lock().rows["task"].transferred, 5);
    assert_eq!(tasks.lock().rows["task"].error, Some(error));
}

#[test]
fn disconnect_and_zero_write_preserve_bytes_accepted_by_the_writer() {
    for zero in [false, true] {
        let tasks = transfer_tasks(10);
        let mut output = ShortWriter {
            data: vec![],
            limit: 3,
            interrupted: false,
            zero,
        };
        let result = copy_body(
            &mut Cursor::new(b"0123456789"),
            &mut output,
            10,
            &tasks,
            "task",
        );
        let error = super::super::tasks::finish_task(&tasks, "task", result).unwrap_err();
        assert_eq!(
            error.code,
            if zero {
                "io:write_zero"
            } else {
                "io:broken_pipe"
            }
        );
        assert_eq!(output.data, b"012");
        assert_eq!(tasks.lock().rows["task"].status, "failed");
        assert_eq!(tasks.lock().rows["task"].transferred, 3);
        assert_eq!(tasks.lock().rows["task"].error, Some(error));
    }
}

#[test]
fn cancellation_after_a_partial_write_stops_before_remaining_bytes() {
    let tasks = transfer_tasks(10);
    struct CancelWriter(SharedTasks, Vec<u8>);
    impl Write for CancelWriter {
        fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
            let count = buffer.len().min(2);
            self.1.extend_from_slice(&buffer[..count]);
            self.0.lock().rows.get_mut("task").unwrap().status = "canceled".into();
            Ok(count)
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }
    let mut output = CancelWriter(tasks.clone(), vec![]);
    let error = copy_body(
        &mut Cursor::new(b"0123456789"),
        &mut output,
        10,
        &tasks,
        "task",
    )
    .unwrap_err();
    assert_ne!(error.kind(), ErrorKind::Interrupted);
    let error = AppError::from(error);
    assert_eq!(
        error,
        AppError::custom(CustomErrorCode::LanTransferCancelled)
    );
    assert_eq!(output.1, b"01");
    assert_eq!(tasks.lock().rows["task"].transferred, 2);
    assert_eq!(tasks.lock().rows["task"].status, "canceled");
}

#[test]
fn empty_download_has_headers_and_cancellation_still_wins() {
    let tasks = transfer_tasks(0);
    let mut output = vec![];
    write_file_range_response(
        &mut output,
        "application/octet-stream",
        &mut Cursor::new(b""),
        RangeRequest::Absent.resolve(0).unwrap(),
        0,
        &[],
        &tasks,
        "task",
    )
    .unwrap();
    assert!(String::from_utf8(output)
        .unwrap()
        .ends_with("Content-Length: 0\r\nAccept-Ranges: bytes\r\nConnection: close\r\n\r\n"));
    tasks.lock().rows.get_mut("task").unwrap().status = "canceled".into();
    let error = copy_body(&mut Cursor::new(b""), &mut vec![], 0, &tasks, "task").unwrap_err();
    assert_eq!(AppError::from(error).code, "lan:transfer_cancelled");
}
