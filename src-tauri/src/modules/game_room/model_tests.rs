use super::*;
use serde_json::json;

#[test]
fn status_keeps_camel_case_nullable_fields_and_host_code() {
    for (phase, seat, code) in [
        ("idle", None, None),
        ("hosting", Some(0), Some("private-code")),
        ("joined", Some(1), None),
    ] {
        let active = phase != "idle";
        let payload = json!({
            "phase": phase,
            "instanceId": active.then_some("instance"),
            "roomId": active.then_some("room-id"),
            "gameId": active.then_some("gomoku"),
            "roomName": active.then_some("room"),
            "host": active.then_some("127.0.0.1"),
            "port": active.then_some(27183),
            "seat": seat,
            "playerName": active.then_some("player"),
            "peerName": null,
            "hasCode": active,
            "code": code,
        });
        let status: GameRoomStatus = serde_json::from_value(payload.clone()).unwrap();
        assert_eq!(serde_json::to_value(status).unwrap(), payload);
    }
}

#[test]
fn discovered_room_keeps_existing_summary_fields() {
    let payload = json!({
        "roomId": "room-id", "gameId": "gomoku", "roomName": "room",
        "hostName": "host", "ip": "127.0.0.1", "port": 27183, "hasCode": true,
    });
    let room: GameRoomSummary = serde_json::from_value(payload.clone()).unwrap();
    assert_eq!(serde_json::to_value(room).unwrap(), payload);
}

#[test]
fn discovered_room_without_display_names_stays_absent_not_backend_copy() {
    let room: GameRoomSummary = serde_json::from_value(json!({
        "roomId": "room-id", "gameId": "gomoku", "ip": "127.0.0.1",
        "port": 27183, "hasCode": false,
    }))
    .unwrap();
    assert_eq!(room.room_name, None);
    assert_eq!(room.host_name, None);
}
