use super::*;
use crate::error::AppErrorKind;
use std::sync::mpsc;
use std::time::Duration;

fn manager() -> Manager {
    Manager::new(std::env::temp_dir().join(format!("mftp-control-{}.json", uuid::Uuid::new_v4())))
}

#[test]
fn cancel_wakes_paused_waiter_and_releases_final_guard() {
    let manager = manager();
    let guard = manager.transfer_guard(Some("transfer")).unwrap();
    manager.pause_transfer("transfer").unwrap();
    let (started_tx, started_rx) = mpsc::channel();
    let (tx, rx) = mpsc::channel();
    let worker = std::thread::spawn(move || {
        started_tx.send(()).unwrap();
        let result = guard.check();
        drop(guard);
        tx.send(result).unwrap();
    });
    started_rx.recv_timeout(Duration::from_secs(2)).unwrap();
    let blocked = rx.recv_timeout(Duration::from_millis(50));
    manager.cancel_transfer("transfer");
    let result = rx.recv_timeout(Duration::from_secs(2));
    assert!(matches!(blocked, Err(mpsc::RecvTimeoutError::Timeout)));
    let error = result.unwrap().unwrap_err();
    worker.join().unwrap();
    assert_eq!(error.kind, AppErrorKind::Custom);
    assert_eq!(error.code, CustomErrorCode::SftpTransferCancelled.as_str());
    assert!(manager.transfers.lock().is_empty());
}

#[test]
fn control_errors_are_structured_and_nested_guards_keep_registration() {
    let manager = manager();
    for result in [
        manager.pause_transfer("missing"),
        manager.resume_transfer("missing"),
    ] {
        assert_eq!(
            result.unwrap_err(),
            AppError::custom(CustomErrorCode::SftpTransferNotFound)
        );
    }
    let first = manager.transfer_guard(Some("transfer")).unwrap();
    let second = manager.transfer_guard(Some("transfer")).unwrap();
    first.enter_unpausable().unwrap();
    assert_eq!(
        manager.pause_transfer("transfer").unwrap_err(),
        AppError::custom(CustomErrorCode::SftpTransferNotPausable)
    );
    manager.cancel_all_transfers();
    assert_eq!(
        first.io_paused().unwrap_err(),
        AppError::custom(CustomErrorCode::SftpTransferCancelled)
    );
    assert_eq!(
        manager.resume_transfer("transfer").unwrap_err(),
        AppError::custom(CustomErrorCode::SftpTransferCancelled)
    );
    drop(first);
    assert!(manager.transfers.lock().contains_key("transfer"));
    drop(second);
    assert!(manager.transfers.lock().is_empty());
}

#[test]
fn early_cancellation_survives_registration_and_io_wrapping() {
    let manager = manager();
    manager.cancel_transfer("early");
    let guard = manager.transfer_guard(Some("early")).unwrap();
    let expected = AppError::custom(CustomErrorCode::SftpTransferCancelled);
    assert_eq!(guard.enter_unpausable().unwrap_err(), expected);
    let mut reader = super::super::transfer_models::TransferReader {
        inner: std::io::Cursor::new(b"data"),
        transfer: Some(&guard),
    };
    let mut buffer = [0; 4];
    let error = std::io::Read::read(&mut reader, &mut buffer).unwrap_err();
    assert_eq!(AppError::from(error), expected);
    drop(guard);
    assert!(manager.transfers.lock().is_empty());
}
