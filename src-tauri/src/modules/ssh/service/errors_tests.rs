use super::*;
use ssh2::ErrorCode;
use std::io;

#[test]
fn messages_cannot_trigger_reconnect() {
    for message in [
        "socket timeout; session(-7); broken pipe",
        "transfer cancelled",
        "传输已取消",
        "translated diagnostic",
    ] {
        for code in [
            "io:other",
            "io:permission_denied",
            "ssh:authentication_failed",
            "ssh:remote_exit",
            "ssh:sftp",
        ] {
            let error = AppError::external(code, message);
            assert!(!stale_app_error(&error));
        }
        let mut error = AppError::custom(CustomErrorCode::SftpTransferCancelled);
        error.message = message.into();
        assert!(!stale_app_error(&error));
    }
    for source in [
        ErrorCode::SFTP(3),
        ErrorCode::SFTP(8),
        ErrorCode::Session(-18),
    ] {
        assert!(!stale_session_error(&ssh2::Error::new(
            source,
            "socket timeout"
        )));
    }
}

#[test]
fn only_known_transport_categories_and_local_stall_are_retryable() {
    for source in [
        ErrorCode::Session(-9),
        ErrorCode::Session(-7),
        ErrorCode::Session(-37),
        ErrorCode::SFTP(6),
        ErrorCode::SFTP(7),
    ] {
        assert!(stale_session_error(&ssh2::Error::new(
            source,
            "no transport keywords"
        )));
    }
    for kind in [
        io::ErrorKind::TimedOut,
        io::ErrorKind::ConnectionReset,
        io::ErrorKind::ConnectionAborted,
        io::ErrorKind::NotConnected,
        io::ErrorKind::BrokenPipe,
        io::ErrorKind::WouldBlock,
    ] {
        assert!(stale_app_error(
            &io::Error::new(kind, "arbitrary text").into()
        ));
    }
    assert!(stale_app_error(&AppError::custom(
        CustomErrorCode::SftpWriteStalled
    )));
    let mut wrong_kind = AppError::external("ssh:disconnected", "text");
    wrong_kind.kind = AppErrorKind::Custom;
    assert!(!stale_app_error(&wrong_kind));
    assert!(!stale_app_error(&AppError::external(
        "sftp:write_stalled",
        "text"
    )));
}

#[test]
fn ssh2_lossy_io_conversion_is_conservative() {
    // ssh2 0.9.6 retains only text for most Read/Write failures. A typed
    // wrapper can be recovered, but an erased code must never be guessed.
    let lossy: io::Error = ssh2::Error::from_errno(ErrorCode::Session(-7)).into();
    let converted = AppError::from(lossy);
    assert_eq!(converted.code, "io:other");
    assert!(!stale_app_error(&converted));
    let timeout: io::Error = ssh2::Error::from_errno(ErrorCode::Session(-9)).into();
    assert!(stale_app_error(&AppError::from(timeout)));
}
