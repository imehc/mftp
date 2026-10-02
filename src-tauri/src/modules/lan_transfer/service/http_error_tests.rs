use super::*;
use crate::error::CustomErrorCode;
use std::io::Read;
use std::net::TcpListener;
use std::time::Duration;

#[test]
fn response_status_depends_on_kind_and_code_not_diagnostics() {
    use CustomErrorCode::*;
    for (code, expected) in [
        (LanRequestInvalid, "400"),
        (LanRequestHeadersTooLarge, "431"),
        (LanUploadInvalid, "400"),
        (LanUploadNameInvalid, "400"),
        (LanUploadTargetInvalid, "400"),
        (LanUploadOffsetMismatch, "409"),
        (LanUploadTargetBusy, "409"),
        (LanUploadSpaceInsufficient, "507"),
        (LanTransferLimitReached, "429"),
        (LanTransferCancelled, "409"),
        (LanTransferIncomplete, "500"),
        (LanShareUnknown, "400"),
        (LanSharedPathInvalid, "400"),
        (LanSharedDirUnavailable, "503"),
    ] {
        let error = AppError::custom(code).context("unrelated diagnostic");
        assert!(status(&error).starts_with(expected));
        assert_eq!(
            status(&AppError {
                kind: AppErrorKind::External,
                ..error
            }),
            "500 Internal Server Error"
        );
    }
    for (kind, expected) in [
        (std::io::ErrorKind::UnexpectedEof, "400"),
        (std::io::ErrorKind::TimedOut, "408"),
        (std::io::ErrorKind::WouldBlock, "408"),
        (std::io::ErrorKind::AlreadyExists, "409"),
        (std::io::ErrorKind::PermissionDenied, "403"),
        (std::io::ErrorKind::NotFound, "404"),
        (std::io::ErrorKind::WriteZero, "500"),
    ] {
        let error = AppError::from(std::io::Error::new(kind, "unrelated diagnostic"));
        assert!(status(&error).starts_with(expected));
        assert_eq!(
            status(&AppError {
                kind: AppErrorKind::Custom,
                ..error
            }),
            "500 Internal Server Error"
        );
    }
}

#[test]
fn remote_response_keeps_plain_text_without_local_external_details_or_args() {
    for error in [
        AppError::from(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "private-path",
        ))
        .with_arg("path", "private-path"),
        AppError::custom(CustomErrorCode::LanUploadOffsetMismatch)
            .with_arg("expected", 10)
            .with_arg("path", "private-path"),
    ] {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let mut client = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        client
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let (mut server, _) = listener.accept().unwrap();
        let original = error.clone();
        write_error(&mut server, &error).unwrap();
        drop(server);
        let mut response = String::new();
        client.read_to_string(&mut response).unwrap();
        assert!(response.starts_with(&format!("HTTP/1.1 {}", status(&error))));
        assert!(response.contains("Content-Type: text/plain; charset=utf-8\r\n"));
        let (head, body) = response.split_once("\r\n\r\n").unwrap();
        assert!(head.contains(&format!("Content-Length: {}\r\n", body.len())));
        assert!(!response.contains("private-path"));
        assert_eq!(error, original);
    }
}

#[test]
fn json_egress_keeps_the_error_body_contract_with_mapped_status() {
    for (error, status_prefix, expect_body) in [
        (
            AppError::custom(CustomErrorCode::LanSharedPathInvalid).with_arg("path", "private"),
            "400",
            "Requested path is invalid or escapes the shared directory",
        ),
        (
            AppError::from(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "private-path",
            )),
            "404",
            "404 Not Found",
        ),
    ] {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let mut client = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        client
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let (mut server, _) = listener.accept().unwrap();
        write_error_json(&mut server, &error).unwrap();
        drop(server);
        let mut response = String::new();
        client.read_to_string(&mut response).unwrap();
        assert!(response.starts_with(&format!("HTTP/1.1 {status_prefix}")));
        assert!(response.contains("Content-Type: application/json; charset=utf-8\r\n"));
        assert!(response.ends_with(&format!("{{\"error\":\"{expect_body}\"}}")));
        assert!(!response.contains("private"));
    }
}
