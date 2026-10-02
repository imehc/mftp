use super::*;
use crate::error::{AppErrorKind, CustomErrorCode};
use ssh2::ErrorCode;
use std::io;

#[test]
fn numeric_ssh_codes_preserve_source_without_message_classification() {
    for (source, code) in [
        (ErrorCode::Session(-9), "ssh:timed_out"),
        (ErrorCode::Session(-30), "ssh:timed_out"),
        (ErrorCode::Session(-18), "ssh:authentication_failed"),
        (ErrorCode::Session(-7), "ssh:disconnected"),
        (ErrorCode::Session(-13), "ssh:disconnected"),
        (ErrorCode::Session(-43), "ssh:disconnected"),
        (ErrorCode::Session(-45), "ssh:disconnected"),
        (ErrorCode::Session(-37), "ssh:would_block"),
        (ErrorCode::Session(-1), "ssh:session"),
        (ErrorCode::SFTP(6), "ssh:disconnected"),
        (ErrorCode::SFTP(7), "ssh:disconnected"),
        (ErrorCode::SFTP(3), "ssh:sftp"),
        (ErrorCode::SFTP(8), "ssh:sftp"),
    ] {
        let error = ssh2::Error::new(source, "arbitrary remote diagnostic");
        let converted = AppError::from(error);
        assert_eq!(converted.kind, AppErrorKind::External);
        assert_eq!(converted.code, code);
        let (name, number) = match source {
            ErrorCode::Session(number) => ("session", number),
            ErrorCode::SFTP(number) => ("sftp", number),
        };
        assert_eq!(converted.args["source"], name);
        assert_eq!(converted.args["sourceCode"], number.to_string());
        assert!(converted.message.contains("arbitrary remote diagnostic"));
    }
}

#[test]
fn nested_io_preserves_ssh_codes_and_complete_application_errors() {
    let ssh = ssh2::Error::from_errno(ErrorCode::SFTP(7));
    let expected = AppError::from_ssh(&ssh);
    let wrapped = io::Error::other(io::Error::other(ssh));
    assert_eq!(AppError::from(wrapped), expected);
    let cancelled = AppError::custom(CustomErrorCode::SftpTransferCancelled)
        .with_arg("transferId", "transfer-42");
    let wrapped = io::Error::other(io::Error::other(cancelled.clone()));
    assert_eq!(AppError::from(wrapped), cancelled);
}

#[test]
fn remote_exit_keeps_external_identity_and_bounds_unicode_diagnostic() {
    let error = AppError::ssh_remote_exit(23, &"界".repeat(5000));
    assert_eq!(error.kind, AppErrorKind::External);
    assert_eq!(error.code, "ssh:remote_exit");
    assert_eq!(error.args["exitCode"], "23");
    assert_eq!(error.message.chars().count(), 4096);
    assert_eq!(
        AppError::ssh_remote_exit(1, " \n ").message,
        "Remote command failed"
    );
}

#[test]
fn directory_walk_failure_keeps_io_category_and_path() {
    let path = std::env::temp_dir().join(format!("mftp-missing-{}", uuid::Uuid::new_v4()));
    let error = walkdir::WalkDir::new(&path)
        .into_iter()
        .next()
        .unwrap()
        .unwrap_err();
    let error = AppError::from(error).context("Scanning directory");
    assert_eq!(error.kind, AppErrorKind::External);
    assert_eq!(error.code, "io:not_found");
    assert_eq!(error.args["path"], path.display().to_string());
}
