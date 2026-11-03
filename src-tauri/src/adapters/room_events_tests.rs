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

#[test]
fn party_events_preserve_verified_identity_and_project_only_compatibility_messages() {
    use crate::modules::game_room::{
        GamePartyEnvelope, GamePartyEvent, GamePartyMember, GamePartyMessageKind,
    };
    let app = tauri::test::mock_builder()
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let received = Arc::new(Mutex::new(Vec::new()));
    for topic in [
        "game-room://peer",
        "game-room://message",
        "game-room://party",
    ] {
        let captured = received.clone();
        app.listen_any(topic, move |event| {
            captured.lock().push((
                topic,
                serde_json::from_str::<Value>(event.payload()).unwrap(),
            ))
        });
    }
    let sink = event_sink(app.handle());
    sink(
        "instance",
        RoomEvent::Party(GamePartyEvent::Members {
            instance_id: "instance".into(),
            local_seat: 1,
            members: vec![
                GamePartyMember {
                    member_id: "host".into(),
                    seat: 0,
                    name: "host-name".into(),
                    connected: true,
                    connection_generation: 0,
                },
                GamePartyMember {
                    member_id: "guest".into(),
                    seat: 1,
                    name: "guest-name".into(),
                    connected: true,
                    connection_generation: 2,
                },
            ],
        }),
    );
    let envelope = GamePartyEnvelope {
        protocol_version: 3,
        room_id: "room".into(),
        match_id: "room".into(),
        rules_version: 1,
        generation: 1,
        revision: 0,
        action_id: "action".into(),
        sequence: 1,
        kind: GamePartyMessageKind::Request,
        payload: "{\"t\":\"authority-v2\"}".into(),
    };
    sink(
        "instance",
        RoomEvent::Party(GamePartyEvent::Message {
            instance_id: "instance".into(),
            member_id: "guest".into(),
            seat: 1,
            connection_generation: 2,
            envelope: envelope.clone(),
        }),
    );
    let mut private = envelope;
    private.kind = GamePartyMessageKind::Snapshot;
    private.sequence = 2;
    sink(
        "instance",
        RoomEvent::Party(GamePartyEvent::Message {
            instance_id: "instance".into(),
            member_id: "guest".into(),
            seat: 1,
            connection_generation: 2,
            envelope: private,
        }),
    );
    let rows = received.lock();
    assert_eq!(
        rows[0],
        (
            "game-room://peer",
            json!({"instanceId":"instance", "connected":true, "name":"host-name"})
        )
    );
    assert_eq!(
        rows.iter()
            .filter(|(topic, _)| *topic == "game-room://message")
            .count(),
        1
    );
    let verified = &rows
        .iter()
        .filter(|(topic, _)| *topic == "game-room://party")
        .nth(1)
        .unwrap()
        .1;
    assert_eq!(verified["memberId"], "guest");
    assert_eq!(verified["seat"], 1);
    assert_eq!(verified["connectionGeneration"], 2);
    assert_eq!(
        rows.iter()
            .filter(|(topic, _)| *topic == "game-room://party")
            .count(),
        3
    );
}
