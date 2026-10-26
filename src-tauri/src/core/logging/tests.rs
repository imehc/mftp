use super::{LogService, Payload};
use crate::{core::diagnostics::Diagnostics, models::ActivityLog, storage::now_ms};
use std::{fs, io::Write, path::PathBuf};

fn temp_root(label: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!("mftp-logging-{label}-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    root
}

fn record(id: &str) -> ActivityLog {
    ActivityLog {
        id: id.into(),
        created_at: now_ms(),
        source: "test".into(),
        ip: "127.0.0.1".into(),
        request_type: "probe".into(),
        result: "success".into(),
        detail: Some("done".into()),
        operation_id: None,
        error: None,
    }
}

#[test]
fn operation_is_written_and_read_after_flush() {
    let root = temp_root("append");
    let logs = LogService::open(root.clone());
    logs.operation(record("history-1"));
    logs.flush().unwrap();

    let page = logs.page(None, 100).unwrap();
    assert_eq!(page.entries.len(), 1);
    assert_eq!(page.entries[0].summary.as_ref().unwrap().id, "history-1");
    assert!(page.health.error.is_none());

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn diagnostic_delta_rebuilds_operation_detail() {
    let root = temp_root("detail");
    let logs = LogService::open(root.clone());
    let diagnostics = Diagnostics::with_log_service(None, Some(logs.clone()));
    let mut recorder = diagnostics
        .begin("http", "get", "https://example.test")
        .unwrap();
    recorder.add_secret("secret-value");
    recorder.http_request(
        "GET",
        "https://example.test?token=secret-value",
        vec![("Authorization".into(), b"secret-value".to_vec())],
        b"request",
    );
    recorder.finish(None);
    let id = recorder.id().to_owned();
    drop(recorder);
    logs.flush().unwrap();

    let page = logs.page(None, 100).unwrap();
    let operation = page
        .entries
        .iter()
        .find_map(|entry| entry.operation.clone())
        .unwrap();
    assert_eq!(operation.id, id);
    assert!(operation.details.is_empty());
    let detail = logs.detail(&id).unwrap().unwrap();
    assert_eq!(detail.details.len(), 1);
    let json = serde_json::to_string(&detail).unwrap();
    assert!(!json.contains("secret-value"));
    assert!(json.contains("[REDACTED]"));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn runtime_events_keep_action_and_result_in_the_summary_projection() {
    let root = temp_root("runtime");
    let logs = LogService::open(root.clone());
    logs.runtime_event(
        "game_room",
        "peer_receive",
        "success",
        "instance_id=room payload={\"move\":1}".into(),
        None,
    );
    logs.flush().unwrap();

    let page = logs.page(None, 100).unwrap();
    let summary = page.entries[0].summary.as_ref().unwrap();
    assert_eq!(summary.source, "runtime");
    assert_eq!(summary.ip, "game_room");
    assert_eq!(summary.request_type, "peer_receive");
    assert_eq!(summary.result, "success");
    assert_eq!(
        summary.detail.as_deref(),
        Some("instance_id=room payload={\"move\":1}")
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn malformed_lines_are_reported_without_hiding_valid_entries() {
    let root = temp_root("malformed");
    let logs = LogService::open(root.clone());
    logs.operation(record("history-2"));
    logs.flush().unwrap();
    let file = super::reader::files(&root)
        .unwrap()
        .into_iter()
        .next()
        .unwrap();
    let mut handle = fs::OpenOptions::new()
        .append(true)
        .open(root.join(file.id))
        .unwrap();
    handle.write_all(b"not-json\n").unwrap();
    handle.flush().unwrap();

    let page = logs.page(None, 100).unwrap();
    assert_eq!(page.entries.len(), 1);
    assert!(page.health.malformed >= 1);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn clearing_files_invalidates_previous_cursor() {
    let root = temp_root("cursor");
    let logs = LogService::open(root.clone());
    logs.operation(record("history-3"));
    logs.operation(record("history-4"));
    logs.flush().unwrap();
    let first = logs.page(None, 1).unwrap();
    let cursor = first.next.unwrap();
    logs.clear(None).unwrap();
    let error = logs.page(Some(&cursor), 1).unwrap_err();
    assert_eq!(error.code, "logs:cursor");

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn legacy_import_is_idempotent() {
    let root = temp_root("migration");
    let logs = LogService::open(root.clone());
    let rows = vec![record("legacy-1"), record("legacy-2")];
    logs.import_legacy(&rows).unwrap();
    logs.import_legacy(&rows).unwrap();
    logs.flush().unwrap();
    let page = logs.page(None, 100).unwrap();
    let ids: Vec<_> = page
        .entries
        .iter()
        .filter_map(|entry| entry.summary.as_ref().map(|row| row.id.as_str()))
        .collect();
    assert_eq!(ids, vec!["legacy-2", "legacy-1"]);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn payload_keeps_protocol_variant_private_to_the_reader() {
    let _ = Payload::Gap { discarded: 1 };
}
