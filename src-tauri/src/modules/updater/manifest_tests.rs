use super::*;
use crate::core::diagnostics::{DiagnosticDetail, DiagnosticStatus};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread;

fn manifest_bytes(version_code: u64) -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({
        "packageName": "com.imehc.mftp", "version": "0.2.6",
        "versionCode": version_code, "url": "https://example.invalid/app.apk",
        "size": 1234, "sha256": "a".repeat(64), "notes": "Release notes",
    }))
    .unwrap()
}

fn response(status: &str, body: &[u8], extra_headers: &str) -> Vec<u8> {
    let mut bytes = format!(
        "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n{extra_headers}\r\n",
        body.len(),
    )
    .into_bytes();
    bytes.extend_from_slice(body);
    bytes
}

fn request_fixture(bytes: Vec<u8>, diagnostics: &Diagnostics) -> AppResult<AndroidUpdateManifest> {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = format!("http://{}/manifest", listener.local_addr().unwrap());
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut request = Vec::new();
        let mut buffer = [0u8; 1024];
        while !request.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
            let count = stream.read(&mut buffer).unwrap();
            assert!(count > 0);
            request.extend_from_slice(&buffer[..count]);
        }
        assert!(String::from_utf8_lossy(&request).contains("mftp-android-updater"));
        let _ = stream.write_all(&bytes);
    });
    let client = Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .build()
        .unwrap();
    let log = diagnostics.begin("updater", "android_manifest", &address);
    let result = fetch_with(&client, &address, diagnostics, Some("check-id"), log);
    server.join().unwrap();
    result
}

fn operation(diagnostics: &Diagnostics) -> crate::core::diagnostics::DiagnosticOperation {
    diagnostics.snapshot(0).operations.unwrap().remove(0)
}

#[test]
fn same_and_older_versions_are_current_and_newer_version_is_available() {
    for (remote, available) in [(2005, false), (2006, false), (2007, true)] {
        let manifest = serde_json::from_slice(&manifest_bytes(remote)).unwrap();
        let info = update_info(manifest, "0.2.6".into(), 2006);
        assert_eq!(info.available, available);
        assert_eq!(info.current_version_code, 2006);
        assert_eq!(info.version_code, remote);
    }
}

#[test]
fn successful_check_logs_actual_request_and_complete_manifest_response() {
    let diagnostics = Diagnostics::default();
    let body = manifest_bytes(2006);
    let remote = request_fixture(response("200 OK", &body, ""), &diagnostics).unwrap();
    assert_eq!(remote.version_code, 2006);
    let recorded = operation(&diagnostics);
    assert_eq!(recorded.correlation_id.as_deref(), Some("check-id"));
    assert_eq!(recorded.status, DiagnosticStatus::Passed);
    assert!(
        matches!(&recorded.details[0], DiagnosticDetail::HttpRequest { method, .. } if method == "GET")
    );
    let DiagnosticDetail::HttpResponse {
        body: received,
        status,
        ..
    } = &recorded.details[1]
    else {
        panic!("HTTP response missing");
    };
    assert_eq!(*status, 200);
    assert_eq!(received.text.as_bytes(), body);
    assert_eq!(received.end, DiagnosticBodyEnd::Complete);
}

#[test]
fn http_failure_preserves_status_response_and_structured_error() {
    let diagnostics = Diagnostics::default();
    let error = request_fixture(
        response("503 Service Unavailable", b"release unavailable", ""),
        &diagnostics,
    )
    .unwrap_err();
    assert_eq!(error.code, "updater:check_failed");
    assert_eq!(error.args["stage"], "status");
    assert_eq!(error.args["status"], "503");
    let recorded = operation(&diagnostics);
    assert_eq!(recorded.status, DiagnosticStatus::Failed);
    assert_eq!(recorded.error.unwrap().code, error.code);
    assert!(
        matches!(&recorded.details[1], DiagnosticDetail::HttpResponse { body, .. } if body.text == "release unavailable")
    );
}

#[test]
fn invalid_json_is_a_decode_failure_not_a_current_version() {
    let diagnostics = Diagnostics::default();
    let error =
        request_fixture(response("200 OK", b"<html>error</html>", ""), &diagnostics).unwrap_err();
    assert_eq!(error.args["stage"], "decode");
    assert_eq!(operation(&diagnostics).status, DiagnosticStatus::Failed);
}

#[test]
fn invalid_manifest_is_a_validation_failure() {
    let diagnostics = Diagnostics::default();
    let error =
        request_fixture(response("200 OK", &manifest_bytes(0), ""), &diagnostics).unwrap_err();
    assert_eq!(error.args["stage"], "manifest");
}

#[test]
fn declared_oversize_body_is_not_read_and_is_marked_uncaptured() {
    let diagnostics = Diagnostics::default();
    let bytes = format!(
        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        MAX_BYTES + 1
    )
    .into_bytes();
    let error = request_fixture(bytes, &diagnostics).unwrap_err();
    assert_eq!(error.args["stage"], "body");
    let recorded = operation(&diagnostics);
    assert!(recorded
        .trace
        .unwrap()
        .text
        .contains("manifest exceeds size limit"));
    assert!(
        matches!(&recorded.details[1], DiagnosticDetail::HttpResponse { body, .. } if body.received_bytes == 0.0 && body.end == DiagnosticBodyEnd::Interrupted)
    );
}

#[test]
fn unknown_length_body_stops_at_the_streaming_limit() {
    let diagnostics = Diagnostics::default();
    let mut bytes = b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n".to_vec();
    bytes.extend(vec![b'x'; MAX_BYTES + 4096]);
    let error = request_fixture(bytes, &diagnostics).unwrap_err();
    assert_eq!(error.args["stage"], "body");
    assert!(
        matches!(&operation(&diagnostics).details[1], DiagnosticDetail::HttpResponse { body, .. } if body.received_bytes == (MAX_BYTES + 1) as f64 && body.truncated && body.end == DiagnosticBodyEnd::Interrupted)
    );
}

#[test]
fn response_read_failure_keeps_original_transport_error() {
    let diagnostics = Diagnostics::default();
    let bytes =
        b"HTTP/1.1 200 OK\r\nContent-Length: 1234\r\nConnection: close\r\n\r\npartial".to_vec();
    let error = request_fixture(bytes, &diagnostics).unwrap_err();
    assert_eq!(error.args["stage"], "body");
    assert!(operation(&diagnostics).details.iter().any(|detail| matches!(detail, DiagnosticDetail::TransportError { body } if !body.text.is_empty())));
}

#[test]
fn redirects_cannot_downgrade_to_plain_http() {
    let diagnostics = Diagnostics::default();
    let error = request_fixture(
        response(
            "302 Found",
            b"",
            "Location: http://example.invalid/next\r\n",
        ),
        &diagnostics,
    )
    .unwrap_err();
    assert_eq!(error.args["stage"], "redirect");
    assert!(matches!(
        &operation(&diagnostics).details[1],
        DiagnosticDetail::HttpResponse { status: 302, .. }
    ));
}

#[test]
fn redirect_without_location_preserves_the_actual_response() {
    let diagnostics = Diagnostics::default();
    let error = request_fixture(response("302 Found", b"", ""), &diagnostics).unwrap_err();
    assert_eq!(error.args["stage"], "redirect");
    assert!(operation(&diagnostics)
        .trace
        .unwrap()
        .text
        .contains("redirect body not read"));
}

#[test]
fn full_logging_buffer_does_not_change_successful_business_result() {
    let diagnostics = Diagnostics::default();
    let active: Vec<_> = (0..20)
        .filter_map(|_| diagnostics.begin("fixture", "hold", "local"))
        .collect();
    assert_eq!(active.len(), 20);
    let remote =
        request_fixture(response("200 OK", &manifest_bytes(2006), ""), &diagnostics).unwrap();
    assert_eq!(remote.version_code, 2006);
    assert_eq!(diagnostics.snapshot(0).operations.unwrap().len(), 20);
}

#[test]
fn collected_response_credentials_are_redacted_before_snapshot() {
    let diagnostics = Diagnostics::default();
    let error = request_fixture(
        response(
            "401 Unauthorized",
            br#"{"password":"fixture-secret"}"#,
            "Set-Cookie: token=fixture-secret\r\n",
        ),
        &diagnostics,
    )
    .unwrap_err();
    assert_eq!(error.args["stage"], "status");
    let recorded = serde_json::to_string(&operation(&diagnostics)).unwrap();
    assert!(!recorded.contains("fixture-secret"));
    assert!(recorded.contains("[REDACTED]"));
}

#[test]
fn connection_failure_keeps_stage_and_source_chain_in_live_log() {
    let diagnostics = Diagnostics::default();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = format!("http://{}/manifest", listener.local_addr().unwrap());
    drop(listener);
    let client = Client::builder().no_proxy().build().unwrap();
    let log = diagnostics.begin("updater", "android_manifest", &address);
    let error = fetch_with(&client, &address, &diagnostics, None, log).unwrap_err();
    assert_eq!(error.args["stage"], "request");
    assert!(error.message.matches(": ").count() > 1);
    assert!(operation(&diagnostics).details.iter().any(|detail| matches!(detail, DiagnosticDetail::TransportError { body } if body.text == error.message)));
}

#[test]
fn production_endpoint_remains_the_public_android_manifest() {
    assert_eq!(
        URL,
        "https://github.com/imehc/mftp/releases/latest/download/android.json"
    );
    let _ = fetch as fn(&Diagnostics, Option<&str>) -> AppResult<AndroidUpdateManifest>;
}
