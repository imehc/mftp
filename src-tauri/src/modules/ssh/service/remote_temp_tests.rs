use super::*;
use crate::error::{AppError, CustomErrorCode};
use std::cell::Cell;

#[test]
fn owned_temp_is_cleaned_on_early_error_without_replacing_the_error() {
    let calls = Cell::new(0);
    let expected =
        AppError::custom(CustomErrorCode::SftpTransferCancelled).with_arg("task", "original");
    let result = (|| -> AppResult<()> {
        let _cleanup = Cleanup {
            owned: true,
            action: Some(|| {
                calls.set(calls.get() + 1);
                Err(std::io::Error::from(std::io::ErrorKind::PermissionDenied).into())
            }),
        };
        Err(expected.clone())
    })();
    assert_eq!(result.unwrap_err(), expected);
    assert_eq!(calls.get(), 1);
}

#[test]
fn an_unowned_reservation_never_runs_cleanup() {
    let calls = Cell::new(0);
    drop(Cleanup {
        owned: false,
        action: Some(|| {
            calls.set(calls.get() + 1);
            Ok(())
        }),
    });
    assert_eq!(calls.get(), 0);
}

#[test]
fn cleanup_runs_on_unwind_and_restores_the_shared_session_timeout() {
    let session = Session::new().unwrap();
    session.set_timeout(30_000);
    let calls = Cell::new(0);
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _cleanup = Cleanup {
            owned: true,
            action: Some(|| {
                calls.set(calls.get() + 1);
                Ok(())
            }),
        };
        let _timeout = Timeout::set(&session, CLEANUP_IO_TIMEOUT_MS);
        assert_eq!(session.timeout(), CLEANUP_IO_TIMEOUT_MS);
        panic!("fake early exit");
    }));
    assert!(result.is_err());
    assert_eq!(calls.get(), 1);
    assert_eq!(session.timeout(), 30_000);
}
