use super::*;
use crate::error::AppError;

const SIGNED_URL: &str = "https://assets.example.test/a%2Fb?sp=r&sig=fake-signature%2B123&jwt=fake-jwt.123&filename=a+b.apk#part";
const SAFE_URL: &str =
    "https://assets.example.test/a%2Fb?sp=r&sig=[REDACTED]&jwt=[REDACTED]&filename=a+b.apk#part";

#[test]
fn signed_url_credentials_are_masked_without_changing_ordinary_parameters() {
    let redactor = Redactor::default();
    assert_eq!(redactor.url(SIGNED_URL), SAFE_URL);
    let raw = format!("request for url ({SIGNED_URL}): invalid peer certificate: Revoked");
    let expected = format!("request for url ({SAFE_URL}): invalid peer certificate: Revoked");
    assert_eq!(redactor.text(&raw), (expected, true));
    assert_eq!(redactor.text(SAFE_URL), (SAFE_URL.into(), true));
}

#[test]
fn encoded_case_insensitive_duplicate_and_cloud_signature_keys_are_masked() {
    let redactor = Redactor::default();
    let raw = "HTTPS://EXAMPLE.test/path?%73%69%67=one&JWT=two&sig=three&X-Amz-Signature=four&X-Goog-Signature=five&tokens=42&signature_algorithm=sha256";
    let expected = "HTTPS://EXAMPLE.test/path?%73%69%67=[REDACTED]&JWT=[REDACTED]&sig=[REDACTED]&X-Amz-Signature=[REDACTED]&X-Goog-Signature=[REDACTED]&tokens=42&signature_algorithm=sha256";
    assert_eq!(redactor.text(raw), (expected.into(), true));
    let json = br#"{"jwt":"fake-jwt","sig":"fake-sig","tokens":42}"#;
    assert_eq!(
        redactor.bytes(json, false).0,
        br#"{"jwt":"[REDACTED]","sig":"[REDACTED]","tokens":42}"#
    );
}

#[test]
fn every_published_field_masks_signed_urls_including_initial_target_and_errors() {
    let hub = Diagnostics::default();
    let mut worker = hub
        .begin("updater", "android_manifest", SIGNED_URL)
        .unwrap();
    let initial = hub.snapshot(0).operations.unwrap().remove(0);
    assert_eq!(initial.target, SAFE_URL);
    assert!(initial.redacted);
    worker.http_request("GET", SIGNED_URL, vec![], &[]);
    worker.http_response(302, vec![("location".into(), SIGNED_URL.as_bytes().into())]);
    worker.transport_error(&format!("request for url ({SIGNED_URL}): Revoked"));
    worker.protocol_event(&serde_json::json!({ "url": SIGNED_URL }));
    worker.target(SIGNED_URL);
    worker.finish(Some(
        &AppError::external("updater:check_failed", format!("failed: {SIGNED_URL}"))
            .with_arg("url", SIGNED_URL),
    ));
    let snapshot = hub.snapshot(0);
    let serialized = serde_json::to_string(&snapshot).unwrap();
    assert!(!serialized.contains("fake-signature"));
    assert!(!serialized.contains("fake-jwt"));
    let operation = &snapshot.operations.as_ref().unwrap()[0];
    let DiagnosticDetail::HttpResponse { headers, .. } = &operation.details[1] else {
        panic!("HTTP response missing");
    };
    assert_eq!(headers[0].value, SAFE_URL);
    assert!(headers[0].redacted);
    assert!(operation.error.as_ref().unwrap().message.contains(SAFE_URL));
}

#[test]
fn relative_location_headers_are_masked_without_corrupting_binary_headers() {
    let hub = Diagnostics::default();
    let mut worker = hub.begin("updater", "test", "release").unwrap();
    worker.http_response(
        302,
        vec![
            (
                "Location".into(),
                b"/asset?sig=fake-signature&limit=20".to_vec(),
            ),
            ("binary".into(), vec![0xff, 0x01]),
        ],
    );
    let snapshot = hub.snapshot(0);
    let DiagnosticDetail::HttpResponse { headers, .. } =
        &snapshot.operations.as_ref().unwrap()[0].details[0]
    else {
        panic!("HTTP response missing");
    };
    assert_eq!(headers[0].value, "/asset?sig=[REDACTED]&limit=20");
    assert!(headers[0].redacted);
    assert_eq!(headers[1].value, "ff 01");
    assert!(!headers[1].redacted);
    assert_eq!(
        Redactor::default().url_bytes(b"/\xff?sig=fake&limit=20"),
        (b"/\xff?sig=[REDACTED]&limit=20".to_vec(), true)
    );
}

#[test]
fn truncated_signed_urls_never_publish_credential_prefixes() {
    let redactor = Redactor::default();
    let raw = b"TLS failure: https://example.test/a?sig=fake-secret-value&limit=20";
    let start = raw.windows(4).position(|part| part == b"sig=").unwrap() + 4;
    for end in start + 1..=raw.len() {
        let (safe, changed) = redactor.bytes(&raw[..end], true);
        assert!(changed);
        assert!(!String::from_utf8(safe).unwrap().contains("sig=f"));
    }
    let hub = Diagnostics::default();
    let target = format!("https://example.test/a?sig={}", "fake-secret".repeat(100));
    let _worker = hub.begin("updater", "test", &target).unwrap();
    let operation = hub.snapshot(0).operations.unwrap().remove(0);
    assert_eq!(operation.target, "https://example.test/a?sig=[REDACTED]");
    assert!(operation.metadata_truncated);
    assert!(operation.redacted);
}

#[test]
fn multiple_urls_json_strings_and_unrelated_binary_bytes_keep_original_framing() {
    let redactor = Redactor::default();
    let raw = format!("\u{ff} {{\"url\":\"{SIGNED_URL}\"}}\r\nnext ({SIGNED_URL})");
    let expected = format!("\u{ff} {{\"url\":\"{SAFE_URL}\"}}\r\nnext ({SAFE_URL})");
    assert_eq!(redactor.text(&raw), (expected, true));
    let (safe, changed) = redactor.bytes(b"\xffhttps://example.test/?sig=fake\r\n\x00", false);
    assert_eq!(safe, b"\xffhttps://example.test/?sig=[REDACTED]\r\n\x00");
    assert!(changed);
    let ordinary = "https://EXAMPLE.test/a%2Fb?limit=20&tokens=42&name=a+b#part";
    assert_eq!(redactor.text(ordinary), (ordinary.into(), false));
}
