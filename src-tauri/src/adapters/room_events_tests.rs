use super::*;
use crate::modules::game_room::GameRoomClosedReason;
use parking_lot::Mutex;
use serde_json::{json, Value};
use tauri::Listener;

#[test]
fn typed_room_events_keep_topics_order_nulls_and_opaque_messages() {
    let app = tauri::test::mock_builder()
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let received = Arc::new(Mutex::new(Vec::new()));
    for topic in [
        "game-room://peer",
        "game-room://message",
        "game-room://closed",
    ] {
        let received = received.clone();
        app.listen_any(topic, move |event| {
            received.lock().push((
                topic,
                serde_json::from_str::<Value>(event.payload()).unwrap(),
            ));
        });
    }
    let sink = event_sink(app.handle());
    sink(
        "instance",
        RoomEvent::PeerJoined {
            name: "guest".into(),
        },
    );
    // The local envelope must preserve the opaque network payload byte for byte.
    for payload in [r#"{"t":"move","move":{"seq":1}}"#, "opaque\n\0message"] {
        sink(
            "instance",
            RoomEvent::Message {
                payload: payload.into(),
            },
        );
    }
    sink("instance", RoomEvent::PeerLeft);
    for reason in [
        GameRoomClosedReason::PeerLeft,
        GameRoomClosedReason::ConnectionLost,
        GameRoomClosedReason::Closed,
    ] {
        sink("instance", RoomEvent::Closed { reason });
    }
    assert_eq!(
        *received.lock(),
        vec![
            (
                "game-room://peer",
                json!({"instanceId": "instance", "connected": true, "name": "guest"})
            ),
            (
                "game-room://message",
                json!({"instanceId": "instance", "payload": r#"{"t":"move","move":{"seq":1}}"#})
            ),
            (
                "game-room://message",
                json!({"instanceId": "instance", "payload": "opaque\n\0message"})
            ),
            (
                "game-room://peer",
                json!({"instanceId": "instance", "connected": false, "name": null})
            ),
            (
                "game-room://closed",
                json!({"instanceId": "instance", "reason": "peer-left"})
            ),
            (
                "game-room://closed",
                json!({"instanceId": "instance", "reason": "connection-lost"})
            ),
            (
                "game-room://closed",
                json!({"instanceId": "instance", "reason": "closed"})
            ),
        ]
    );
}
