use super::*;
use crate::models::TransferProgress;
use std::sync::Mutex;
use tauri::Listener;

#[test]
fn terminal_bytes_keep_order_and_session_topics_through_adapter() {
    let app = tauri::test::mock_builder()
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let received = Arc::new(Mutex::new(Vec::new()));
    for topic in [
        "ssh://data/first",
        "ssh://closed/first",
        "ssh://data/second",
        "ssh://closed/second",
    ] {
        let received = received.clone();
        app.listen_any(topic, move |event| {
            received.lock().unwrap().push((
                topic,
                serde_json::from_str::<String>(event.payload()).unwrap(),
            ));
        });
    }
    let sink = event_sink(app.handle());
    sink(SshEvent::Data {
        session_id: "first",
        bytes: &[0, 255, 128],
    });
    sink(SshEvent::Data {
        session_id: "second",
        bytes: b"other",
    });
    sink(SshEvent::Data {
        session_id: "first",
        bytes: b"last",
    });
    sink(SshEvent::Closed {
        session_id: "first",
    });
    assert_eq!(
        *received.lock().unwrap(),
        vec![
            ("ssh://data/first", STANDARD.encode([0, 255, 128])),
            ("ssh://data/second", STANDARD.encode(b"other")),
            ("ssh://data/first", STANDARD.encode(b"last")),
            ("ssh://closed/first", "first".to_owned()),
        ]
    );
}

#[test]
fn sftp_progress_keeps_wire_fields_without_finished_flag() {
    let app = tauri::test::mock_builder()
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let received = Arc::new(Mutex::new(Vec::new()));
    let target = received.clone();
    app.listen_any("sftp-transfer-progress", move |event| {
        target
            .lock()
            .unwrap()
            .push(serde_json::from_str::<serde_json::Value>(event.payload()).unwrap());
    });
    event_sink(app.handle())(SshEvent::Progress(TransferProgress {
        id: "transfer-42".into(),
        phase: "phase".into(),
        transferred: 12,
        total: Some(24),
        finished: None,
    }));
    assert_eq!(
        *received.lock().unwrap(),
        vec![serde_json::json!({
            "id": "transfer-42", "phase": "phase", "transferred": 12, "total": 24,
        })]
    );
}
