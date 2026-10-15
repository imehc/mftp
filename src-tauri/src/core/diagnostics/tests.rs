use super::*;
use crate::error::AppError;

#[test]
fn credentials_are_redacted_without_reformatting_ordinary_payloads() {
    let mut redactor = redaction::Redactor::default();
    redactor.add_secret("secret-123");
    let raw = b"data: { \"text\": \"hello secret-123\", \"password\" : \"other-secret\", \"usage\": {\"tokens\": 42}}\r\n\r\n";
    let (safe, changed) = redactor.bytes(raw, false);
    assert!(changed);
    assert_eq!(String::from_utf8(safe).unwrap(), "data: { \"text\": \"hello [REDACTED]\", \"password\" : \"[REDACTED]\", \"usage\": {\"tokens\": 42}}\r\n\r\n");
}

#[test]
fn clearing_discards_records_and_late_workers_cannot_restore_them() {
    let hub = Diagnostics::default();
    let mut worker = hub.begin("ai", "test", "model").unwrap();
    assert_eq!(hub.snapshot(0).operations.unwrap().len(), 1);
    hub.clear();
    worker.finish(None);
    assert!(hub.snapshot(0).operations.unwrap().is_empty());
}

#[test]
fn final_results_survive_reader_contention_and_history_is_bounded() {
    let hub = Diagnostics::default();
    let mut worker = hub.begin("ai", "test", "model").unwrap();
    let cell = worker.cell.clone();
    let _reader = cell.latest.lock();
    worker.http_request("POST", "https://example.test", vec![], b"{}");
    worker.finish(None);
    assert_eq!(
        hub.snapshot(0).operations.unwrap()[0].status,
        DiagnosticStatus::Passed
    );
    for _ in 0..OPERATION_LIMIT {
        hub.begin("ai", "test", "model").unwrap().finish(None);
    }
    let result = hub.snapshot(0);
    assert_eq!(result.operations.unwrap().len(), OPERATION_LIMIT);
    assert_eq!(result.discarded, 1);
    assert!(hub.snapshot(result.cursor).operations.is_none());
}

#[test]
fn every_partial_credential_prefix_and_sensitive_json_value_stays_private() {
    let hub = Diagnostics::default();
    let mut worker = hub.begin("ai", "test", "model").unwrap();
    worker.add_secret("fake-credential");
    worker.http_response(200, vec![("set-cookie".into(), b"hidden-cookie".to_vec())]);
    for byte in b"{\"echo\":\"fake-credential\",\"access_token\":\"other-value\"}" {
        worker.response_bytes(&[*byte]);
        worker.response_end(DiagnosticBodyEnd::Receiving);
        let text = serde_json::to_string(&hub.snapshot(0)).unwrap();
        assert!(!text.contains("fake-credential"));
        assert!(!text.contains("other-value"));
        assert!(!text.contains("hidden-cookie"));
    }
    worker.finish(None);
    let text = serde_json::to_string(&hub.snapshot(0)).unwrap();
    assert!(text.contains("[REDACTED]"));
}

#[test]
fn oversized_bodies_report_truncation_and_abandoned_workers_are_not_successful() {
    let hub = Diagnostics::default();
    let mut worker = hub.begin("ai", "test", "model").unwrap();
    worker.http_response(200, vec![]);
    worker.response_bytes(&vec![b'x'; recorder::BODY_LIMIT + 100]);
    drop(worker);
    let operation = hub.snapshot(0).operations.unwrap().remove(0);
    assert_eq!(operation.status, DiagnosticStatus::Interrupted);
    let DiagnosticDetail::HttpResponse { body, .. } = &operation.details[0] else {
        panic!("response missing")
    };
    assert!(body.truncated);
    assert_eq!(body.captured_bytes as usize, recorder::BODY_LIMIT);
}

#[test]
fn cleared_scope_workers_still_obey_the_global_active_budget() {
    let hub = Diagnostics::default();
    let mut workers = Vec::new();
    for _ in 0..ACTIVE_LIMIT {
        workers.push(hub.begin("ai", "test", "model").unwrap());
        hub.clear();
    }
    assert!(hub.begin("ai", "test", "model").is_none());
    assert_eq!(hub.snapshot(0).discarded, 1);
    workers.pop();
    assert!(hub.begin("ai", "test", "model").is_some());
    drop(workers);
    assert_eq!(hub.active.load(Ordering::Acquire), 0);
}

#[test]
fn url_and_escaped_json_credentials_preserve_unrelated_bytes() {
    let mut redactor = redaction::Redactor::default();
    redactor.add_secret("fake \"key\"");
    assert_eq!(
        redactor.url(
            "https://name:password@EXAMPLE.test/a%2Fb?q=a+b&access%5Ftoken=secret&limit=20#part"
        ),
        "https://name:[REDACTED]@EXAMPLE.test/a%2Fb?q=a+b&access%5Ftoken=[REDACTED]&limit=20#part"
    );
    let raw = br#"{ "pass\u0077ord" : "escaped\"value", "echo":"fake \"key\"", "note":"\"token\": harmless", "tokens": 23 }"#;
    let (safe, changed) = redactor.bytes(raw, false);
    assert!(changed);
    assert_eq!(safe, br#"{ "pass\u0077ord" : "[REDACTED]", "echo":"[REDACTED]", "note":"\"token\": harmless", "tokens": 23 }"#);
    assert_eq!(redactor.text("fake+%22key%22").0, "[REDACTED]");
}

#[test]
fn binary_headers_and_body_remain_lossless_after_redaction() {
    let hub = Diagnostics::default();
    let mut log = hub.begin("ai", "test", "model").unwrap();
    log.add_secret("fake-key");
    log.http_response(200, vec![("x-raw".into(), b"\xff fake-key".to_vec())]);
    log.response_bytes(b"\xff fake-key");
    log.response_end(DiagnosticBodyEnd::Complete);
    log.finish(None);
    let operation = hub.snapshot(0).operations.unwrap().remove(0);
    let DiagnosticDetail::HttpResponse { headers, body, .. } = &operation.details[0] else {
        panic!("response missing")
    };
    assert_eq!(body.encoding, "hex");
    assert_eq!(body.text, "ff 20 5b 52 45 44 41 43 54 45 44 5d");
    assert!(body.redacted);
    assert_eq!(headers[0].value, body.text);
    assert_eq!(headers[0].encoding, "hex");
    assert!(headers[0].redacted);
}

#[test]
fn metadata_and_truncated_bodies_never_publish_cut_credential_prefixes() {
    let hub = Diagnostics::default();
    let mut log = hub.begin("ai", "test", "model").unwrap();
    log.add_secret("fake-secret");
    log.target(&format!("{}fake-secret", "x".repeat(506)));
    log.http_response(200, vec![]);
    log.response_bytes(format!("{}fake-secret", "x".repeat(recorder::BODY_LIMIT - 6)).as_bytes());
    log.response_end(DiagnosticBodyEnd::Complete);
    let error = AppError::external("test:error", format!("{}fake-secret", "x".repeat(2042)))
        .with_arg("detail", format!("{}fake-secret", "x".repeat(506)));
    log.finish(Some(&error));
    // A second finish cannot replace the original terminal result.
    log.finish(None);
    let operation = hub.snapshot(0).operations.unwrap().remove(0);
    let serialized = serde_json::to_string(&operation).unwrap();
    assert!(!serialized.contains("fake"));
    assert!(operation.metadata_truncated);
    assert!(operation.redacted);
    assert_eq!(operation.status, DiagnosticStatus::Failed);
    assert_eq!(operation.error.unwrap().code, "test:error");
    let DiagnosticDetail::HttpResponse { body, .. } = &operation.details[0] else {
        panic!("response missing")
    };
    assert!(body.truncated && body.redacted);
}

#[test]
fn header_limits_are_explicit() {
    let hub = Diagnostics::default();
    let mut log = hub.begin("ai", "test", "model").unwrap();
    log.http_response(
        200,
        (0..100)
            .map(|i| (format!("x-{i}"), vec![b'x'; 256]))
            .collect(),
    );
    log.finish(None);
    let operation = hub.snapshot(0).operations.unwrap().remove(0);
    let DiagnosticDetail::HttpResponse {
        headers,
        headers_truncated,
        ..
    } = &operation.details[0]
    else {
        panic!("response missing")
    };
    assert!(*headers_truncated);
    assert!(
        headers
            .iter()
            .map(|header| header.name.len() + header.value.len())
            .sum::<usize>()
            <= 8 * 1024
    );
}

#[test]
fn redaction_expansion_has_an_explicit_view_budget() {
    let hub = Diagnostics::default();
    let mut log = hub.begin("ai", "test", "model").unwrap();
    log.add_secret("x");
    log.http_response(200, vec![]);
    log.response_bytes(&vec![b'x'; recorder::BODY_LIMIT]);
    log.response_end(DiagnosticBodyEnd::Complete);
    log.finish(None);
    let operation = hub.snapshot(0).operations.unwrap().remove(0);
    let DiagnosticDetail::HttpResponse { body, .. } = &operation.details[0] else {
        panic!("response missing")
    };
    assert!(body.truncated && body.redacted);
    assert_eq!(body.text.len(), recorder::VIEW_LIMIT);
    assert!(!body.text.contains('x'));
}
