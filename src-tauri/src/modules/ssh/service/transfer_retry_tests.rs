use super::super::{remote_ops::remote_file_size, types::Manager};
use super::*;
use crate::error::CustomErrorCode;
use parking_lot::Mutex;
use std::cell::{Cell, RefCell};
use std::sync::{mpsc, Arc};

fn disconnected() -> AppError {
    AppError::external("ssh:disconnected", "test transport failure").with_arg("sourceCode", -7)
}

#[test]
fn connection_and_early_attempt_errors_reach_the_same_bounded_retry_loop() {
    let connections = Cell::new(0);
    let attempts = Cell::new(0);
    let invalidations = Cell::new(0);
    let waits = Cell::new(0);
    let lock = Mutex::new(());
    run_with_wait(
        None,
        || {
            connections.set(connections.get() + 1);
            if connections.get() == 1 {
                Err(disconnected())
            } else {
                Ok(&lock)
            }
        },
        |connection| {
            let _guard = connection.lock();
            attempts.set(attempts.get() + 1);
            if attempts.get() < 3 {
                Err(disconnected()).map_err(AttemptError::remote)?;
            }
            Ok(TransferIoOutcome::Complete)
        },
        |connection| {
            assert!(connection.try_lock().is_some());
            invalidations.set(invalidations.get() + 1);
        },
        |_| {},
        |_| {
            assert!(lock.try_lock().is_some());
            waits.set(waits.get() + 1);
            Ok(())
        },
    )
    .unwrap();
    assert_eq!(connections.get(), 4);
    assert_eq!(attempts.get(), 3);
    assert_eq!(invalidations.get(), 2);
    assert_eq!(waits.get(), 3);
}

#[test]
fn local_timeouts_permissions_and_cancellation_never_invalidate_or_retry() {
    for (remote, payload) in [
        (false, AppError::external("io:timed_out", "disk failure")),
        (
            true,
            AppError::external("ssh:sftp", "permission denied").with_arg("sourceCode", 3),
        ),
        (true, AppError::ssh_remote_exit(1, "timeout in remote tool")),
        (
            true,
            AppError::custom(CustomErrorCode::SftpTransferCancelled),
        ),
        (false, AppError::custom(CustomErrorCode::SftpSizeMismatch)),
    ] {
        let attempts = Cell::new(0);
        let result = run_with_wait(
            None,
            || Ok(()),
            |_| {
                attempts.set(attempts.get() + 1);
                Err(if remote {
                    AttemptError::remote(payload.clone())
                } else {
                    AttemptError::local(payload.clone())
                })
            },
            |_| panic!("must not invalidate"),
            |_| panic!("must not retry"),
            |_| panic!("must not wait"),
        );
        assert_eq!(result.unwrap_err(), payload);
        assert_eq!(attempts.get(), 1);
    }
}

#[test]
fn progress_does_not_reset_retry_budget_and_final_broken_connection_is_removed() {
    let progress = Cell::new(0);
    let invalidations = Cell::new(0);
    let delays = RefCell::new(Vec::new());
    let result = run_with_wait(
        None,
        || Ok(()),
        |_| {
            progress.set(progress.get() + 1);
            Err(AttemptError::remote(disconnected()))
        },
        |_| invalidations.set(invalidations.get() + 1),
        |_| {},
        |delay| {
            delays.borrow_mut().push(delay);
            Ok(())
        },
    );
    assert_eq!(result.unwrap_err(), disconnected());
    assert_eq!(progress.get(), SFTP_TRANSFER_RETRIES + 1);
    assert_eq!(invalidations.get(), SFTP_TRANSFER_RETRIES + 1);
    assert_eq!(delays.borrow().len(), SFTP_TRANSFER_RETRIES);
    assert_eq!(delays.borrow()[0], Duration::from_millis(250));
    assert_eq!(delays.borrow().last(), Some(&Duration::from_secs(4)));
}

struct Connection {
    lock: Arc<Mutex<()>>,
    dropped: mpsc::Sender<()>,
}
impl Drop for Connection {
    fn drop(&mut self) {
        self.dropped.send(()).unwrap();
    }
}

#[test]
fn paused_attempt_releases_connection_before_waiting_and_resume_reopens_it() {
    for cancel in [false, true] {
        let manager = Arc::new(Manager::new(
            std::env::temp_dir().join(format!("mftp-pause-{}.json", uuid::Uuid::new_v4())),
        ));
        let transfer = manager.transfer_guard(Some("task")).unwrap();
        let lock = Arc::new(Mutex::new(()));
        let (dropped_tx, dropped_rx) = mpsc::channel();
        let (finished_tx, finished_rx) = mpsc::channel();
        let worker_manager = manager.clone();
        let worker_lock = lock.clone();
        let worker = std::thread::spawn(move || {
            let mut attempts = 0;
            let result = run_transfer(
                Some(&transfer),
                || {
                    Ok(Connection {
                        lock: worker_lock.clone(),
                        dropped: dropped_tx.clone(),
                    })
                },
                |connection| {
                    let _guard = connection.lock.lock();
                    attempts += 1;
                    if attempts == 1 {
                        worker_manager.pause_transfer("task").unwrap();
                        super::super::transfer_io::copy_download(
                            &mut std::io::Cursor::new(b"data"),
                            &mut Vec::new(),
                            Some(&transfer),
                            |_| {},
                            || {},
                        )
                    } else {
                        Ok(TransferIoOutcome::Complete)
                    }
                },
                |_| panic!("pause must not invalidate"),
                |_| panic!("pause must not consume retries"),
            );
            finished_tx.send((attempts, result)).unwrap();
        });
        dropped_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        assert!(lock.try_lock().is_some());
        assert!(finished_rx.try_recv().is_err());
        if cancel {
            manager.cancel_transfer("task");
        } else {
            manager.resume_transfer("task").unwrap();
        }
        let (attempts, result) = finished_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        worker.join().unwrap();
        assert_eq!(attempts, if cancel { 1 } else { 2 });
        if cancel {
            assert_eq!(
                result.unwrap_err(),
                AppError::custom(CustomErrorCode::SftpTransferCancelled)
            );
        } else {
            result.unwrap();
        }
    }
}

#[test]
fn cancellation_wakes_retry_backoff_without_waiting_for_the_deadline() {
    let manager = Manager::new(
        std::env::temp_dir().join(format!("mftp-backoff-{}.json", uuid::Uuid::new_v4())),
    );
    let transfer = manager.transfer_guard(Some("task")).unwrap();
    let (started_tx, started_rx) = mpsc::channel();
    let (tx, rx) = mpsc::channel();
    let worker = std::thread::spawn(move || {
        started_tx.send(()).unwrap();
        tx.send(transfer.wait_retry(Duration::from_secs(30)))
            .unwrap();
    });
    started_rx.recv_timeout(Duration::from_secs(2)).unwrap();
    let blocked = rx.recv_timeout(Duration::from_millis(20));
    manager.cancel_transfer("task");
    assert!(matches!(blocked, Err(mpsc::RecvTimeoutError::Timeout)));
    let result = rx.recv_timeout(Duration::from_secs(2)).unwrap();
    worker.join().unwrap();
    assert_eq!(
        result.unwrap_err(),
        AppError::custom(CustomErrorCode::SftpTransferCancelled)
    );
}

#[test]
fn only_numeric_missing_file_errors_authorize_creating_an_upload_target() {
    for code in [2, 10] {
        assert_eq!(
            remote_file_size(Err(ssh2::Error::from_errno(ssh2::ErrorCode::SFTP(code)))).unwrap(),
            None
        );
    }
    for code in [3, 4, 7, 8] {
        let error = ssh2::Error::from_errno(ssh2::ErrorCode::SFTP(code));
        let expected = AppError::from_ssh(&error);
        assert_eq!(remote_file_size(Err(error)).unwrap_err(), expected);
    }
}

#[test]
fn missing_stat_size_is_not_treated_as_an_absent_upload_target() {
    let stat = ssh2::FileStat {
        size: None,
        uid: None,
        gid: None,
        perm: None,
        atime: None,
        mtime: None,
    };
    let error = remote_file_size(Ok(stat)).unwrap_err();
    assert_eq!(error.kind, crate::error::AppErrorKind::External);
    assert_eq!(error.code, "ssh:invalid_response");
    assert!(!AttemptError::remote(error).reconnect());
}
