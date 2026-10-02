use super::*;
use crate::error::CustomErrorCode;
use crate::models::TransferProgress;
use crate::modules::bt::BtTaskEvent;
use std::sync::Mutex;
use tauri::Listener;

#[test]
fn typed_events_keep_wire_topics_fields_and_complete_errors() {
    let app = tauri::test::mock_builder()
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let received = Arc::new(Mutex::new(Vec::new()));
    for topic in [
        crate::transfer::BT_TASK_EVENT,
        crate::transfer::TRANSFER_PROGRESS_EVENT,
    ] {
        let received = received.clone();
        app.listen_any(topic, move |event| {
            received.lock().unwrap().push((
                topic,
                serde_json::from_str::<serde_json::Value>(event.payload()).unwrap(),
            ));
        });
    }
    let sink = event_sink(app.handle());
    let failure = AppError::custom(CustomErrorCode::BtArchiveAlreadyExists)
        .with_arg("path", "original/archive.tar");
    for event in [
        BtTaskEvent::PackageFailed {
            info_hash: "task".into(),
            error: failure.clone(),
        },
        BtTaskEvent::PackageCompleted {
            info_hash: "task".into(),
        },
        BtTaskEvent::ExportCompleted {
            info_hash: "task".into(),
        },
        BtTaskEvent::Cancelled {
            info_hash: "task".into(),
        },
        BtTaskEvent::Removed {
            info_hash: "task".into(),
        },
    ] {
        sink(BtEvent::Task(event));
    }
    for finished in [false, true] {
        sink(BtEvent::Progress(TransferProgress {
            id: "bt:task".into(),
            phase: "bt:packaging".into(),
            transferred: 64,
            total: Some(64),
            finished: Some(finished),
        }));
    }
    let received = received.lock().unwrap();
    assert_eq!(received.len(), 7);
    for (index, kind) in [
        "package-failed",
        "package-completed",
        "export-completed",
        "cancelled",
        "removed",
    ]
    .iter()
    .enumerate()
    {
        assert_eq!(received[index].0, "bt://task-event");
        assert_eq!(received[index].1["kind"], *kind);
        assert_eq!(received[index].1["infoHash"], "task");
    }
    assert_eq!(
        received[0].1["error"],
        serde_json::to_value(failure).unwrap()
    );
    for (index, finished) in [(5, false), (6, true)] {
        assert_eq!(received[index].0, "sftp-transfer-progress");
        assert_eq!(
            received[index].1,
            serde_json::json!({
                "id": "bt:task", "phase": "bt:packaging", "transferred": 64,
                "total": 64, "finished": finished,
            })
        );
    }
}
