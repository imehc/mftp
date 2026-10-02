use super::*;
use crate::error::CustomErrorCode;
use std::collections::VecDeque;

enum Step {
    Bytes(Vec<u8>),
    Pending,
    Error(io::ErrorKind),
}
struct Channel {
    out: VecDeque<Step>,
    err: VecDeque<Step>,
}
fn read(steps: &mut VecDeque<Step>, buffer: &mut [u8]) -> io::Result<usize> {
    match steps.pop_front() {
        Some(Step::Bytes(mut bytes)) => {
            let count = bytes.len().min(buffer.len());
            buffer[..count].copy_from_slice(&bytes[..count]);
            if bytes.len() > count {
                bytes.drain(..count);
                steps.push_front(Step::Bytes(bytes));
            }
            Ok(count)
        }
        Some(Step::Pending) => Err(io::ErrorKind::WouldBlock.into()),
        Some(Step::Error(kind)) => Err(kind.into()),
        None => Ok(0),
    }
}
impl OutputChannel for Channel {
    fn stdout(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        read(&mut self.out, buffer)
    }
    fn stderr(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        read(&mut self.err, buffer)
    }
    fn eof(&self) -> bool {
        true
    }
}

#[test]
fn drains_both_streams_past_eof_and_discards_excess_diagnostics() {
    let bytes: Vec<_> = (0..180_000).map(|i| (i % 251) as u8).collect();
    let mut channel = Channel {
        out: [Step::Pending, Step::Bytes(bytes.clone())].into(),
        err: [Step::Bytes(vec![b'e'; 200_000])].into(),
    };
    let mut output = Vec::new();
    let (outcome, stderr) = pump(
        &mut channel,
        || Ok(false),
        |part| {
            output.extend_from_slice(part);
            Ok(())
        },
        || Ok(()),
    )
    .unwrap();
    assert_eq!(outcome, TransferIoOutcome::Complete);
    assert_eq!(output, bytes);
    assert_eq!(stderr, "e".repeat(DIAGNOSTIC_LIMIT));
    assert!(channel.err.is_empty());
}

#[test]
fn quiet_commands_keep_polling_until_cancelled_or_paused() {
    for pause in [false, true] {
        let mut channel = Channel {
            out: (0..100).map(|_| Step::Pending).collect(),
            err: (0..100).map(|_| Step::Pending).collect(),
        };
        let mut checks = 0;
        let mut waits = 0;
        let cancelled =
            AppError::custom(CustomErrorCode::SftpTransferCancelled).with_arg("task", "original");
        let result = pump(
            &mut channel,
            || {
                checks += 1;
                if checks == 4 {
                    if pause {
                        Ok(true)
                    } else {
                        Err(cancelled.clone())
                    }
                } else {
                    Ok(false)
                }
            },
            |_| panic!("quiet process produced output"),
            || {
                waits += 1;
                Ok(())
            },
        );
        if pause {
            assert_eq!(result.unwrap().0, TransferIoOutcome::Paused);
        } else {
            assert_eq!(result.err().unwrap().into_error(), cancelled);
        }
        assert_eq!(waits, 3);
    }
}

#[test]
fn stream_and_destination_errors_preserve_origin_and_complete_payload() {
    let mut channel = Channel {
        out: [Step::Bytes(vec![1])].into(),
        err: VecDeque::new(),
    };
    let expected = AppError::custom(CustomErrorCode::SftpSizeMismatch).with_arg("path", "original");
    let error = pump(
        &mut channel,
        || Ok(false),
        |_| Err(AttemptError::local(expected.clone())),
        || Ok(()),
    )
    .err()
    .unwrap();
    assert!(!error.reconnect());
    assert_eq!(error.into_error(), expected);
    let mut channel = Channel {
        out: [Step::Error(io::ErrorKind::ConnectionReset)].into(),
        err: VecDeque::new(),
    };
    let error = pump(&mut channel, || Ok(false), |_| Ok(()), || Ok(()))
        .err()
        .unwrap();
    assert!(error.reconnect());
    assert_eq!(error.into_error().code, "io:connection_reset");
}

#[test]
fn only_numeric_eagain_resumes_a_protocol_call_and_deadline_is_finite() {
    let expected = ssh2::Error::new(ssh2::ErrorCode::Session(-18), "would block");
    let mut calls = 0;
    let error = retry_until(
        || {
            calls += 1;
            Err::<(), _>(ssh2::Error::new(
                ssh2::ErrorCode::Session(-18),
                "would block",
            ))
        },
        &mut || Ok(false),
        Instant::now(),
    )
    .err()
    .unwrap();
    assert_eq!(calls, 1);
    assert_eq!(error.into_error(), AppError::from(expected));
    let error = retry_until(
        || Err::<(), _>(ssh2::Error::from_errno(ssh2::ErrorCode::Session(-37))),
        &mut || Ok(false),
        Instant::now(),
    )
    .err()
    .unwrap();
    assert_eq!(error.into_error().code, "io:timed_out");
}

#[test]
fn cancellation_interrupts_a_pending_protocol_call_without_replaying_work() {
    let mut checks = 0;
    let mut calls = 0;
    let error = retry_ssh(
        || {
            calls += 1;
            Err::<(), _>(ssh2::Error::from_errno(ssh2::ErrorCode::Session(-37)))
        },
        &mut || {
            checks += 1;
            if checks == 2 {
                Err(AppError::custom(CustomErrorCode::SftpTransferCancelled))
            } else {
                Ok(false)
            }
        },
    )
    .err()
    .unwrap();
    assert_eq!(calls, 1);
    assert_eq!(error.into_error().code, "sftp:transfer_cancelled");
}
