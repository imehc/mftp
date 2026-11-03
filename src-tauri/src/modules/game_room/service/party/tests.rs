use super::*;
use crate::{
    core::{diagnostics::Diagnostics, operations::Operations},
    modules::game_room::service::GameRoomManager,
    modules::game_room::{GamePartyCreateInput, GamePartyJoinInput, GamePartyMessageKind as Kind},
};
use std::time::{Duration, Instant};

#[path = "handshake_tests.rs"]
mod handshake;

struct Endpoint {
    manager: GameRoomManager,
    events: Arc<Mutex<Vec<GamePartyEvent>>>,
    logs: Arc<Diagnostics>,
    operations: Arc<Operations>,
}

impl Endpoint {
    fn new() -> Self {
        let events = Arc::new(Mutex::new(Vec::new()));
        let captured = events.clone();
        let logs = Arc::new(Diagnostics::default());
        let operations = Arc::new(Operations::default());
        let manager = GameRoomManager::new(
            Arc::new(move |_, event| {
                if let RoomEvent::Party(event) = event {
                    captured.lock().push(event);
                }
            }),
            operations.clone(),
        );
        let mut manager = manager;
        manager.logs = RoomDiagnostics {
            diagnostics: logs.clone(),
            activity: None,
        };
        Self {
            manager,
            events,
            logs,
            operations,
        }
    }
}

fn wait(check: impl Fn() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(3);
    while !check() {
        assert!(Instant::now() < deadline, "Condition timed out");
        std::thread::sleep(Duration::from_millis(5));
    }
}

fn room(host: &Endpoint) -> GamePartyStatus {
    host.manager
        .create_party(GamePartyCreateInput {
            game_id: "hidden-test".into(),
            rules_version: 1,
            seat_count: 3,
            remote_seats: vec![1, 2],
            room_name: "isolated".into(),
            code: Some("test-room-code".into()),
            player_name: "host".into(),
        })
        .unwrap()
}

fn join(guest: &Endpoint, status: &GamePartyStatus, name: &str) -> GamePartyStatus {
    guest
        .manager
        .join_party(GamePartyJoinInput {
            host: "127.0.0.1".into(),
            port: status.port,
            game_id: status.game_id.clone(),
            rules_version: 1,
            code: Some("test-room-code".into()),
            player_name: name.into(),
        })
        .unwrap()
}

fn envelope(
    room: &GamePartyStatus,
    match_id: &str,
    kind: Kind,
    sequence: u32,
    revision: u32,
    payload: &str,
) -> GamePartyEnvelope {
    GamePartyEnvelope {
        protocol_version: 3,
        room_id: room.room_id.clone(),
        match_id: match_id.into(),
        rules_version: 1,
        generation: 1,
        revision,
        action_id: uuid::Uuid::new_v4().to_string(),
        sequence,
        kind,
        payload: payload.into(),
    }
}

fn messages(endpoint: &Endpoint) -> Vec<(u8, GamePartyEnvelope)> {
    endpoint
        .events
        .lock()
        .iter()
        .filter_map(|event| match event {
            GamePartyEvent::Message { seat, envelope, .. } => Some((*seat, envelope.clone())),
            _ => None,
        })
        .collect()
}

#[test]
fn three_clients_receive_only_public_events_and_their_own_private_snapshot() {
    let host = Endpoint::new();
    let status = room(&host);
    let first = Endpoint::new();
    let second = Endpoint::new();
    let first_status = join(&first, &status, "first");
    let second_status = join(&second, &status, "second");
    wait(|| {
        host.manager.party_status().unwrap().members.len() == 3
            && first.manager.party_status().unwrap().members.len() == 3
    });
    assert_eq!((first_status.seat, second_status.seat), (1, 2));
    let match_id = uuid::Uuid::new_v4().to_string();
    host.manager
        .send_party(
            &status.instance_id,
            None,
            envelope(
                &status,
                &match_id,
                Kind::Start,
                1,
                0,
                "{\"phase\":\"call\"}",
            ),
        )
        .unwrap();
    host.manager
        .send_party(
            &status.instance_id,
            Some(first_status.member_id.clone()),
            envelope(&status, &match_id, Kind::Snapshot, 2, 0, "{\"hand\":[1,2]}"),
        )
        .unwrap();
    host.manager
        .send_party(
            &status.instance_id,
            Some(second_status.member_id.clone()),
            envelope(&status, &match_id, Kind::Snapshot, 3, 0, "{\"hand\":[3,4]}"),
        )
        .unwrap();
    wait(|| messages(&first).len() == 2 && messages(&second).len() == 2);
    assert_eq!(messages(&first)[1].1.payload, "{\"hand\":[1,2]}");
    assert_eq!(messages(&second)[1].1.payload, "{\"hand\":[3,4]}");
    assert!(host
        .manager
        .send_party(
            &status.instance_id,
            None,
            envelope(&status, &match_id, Kind::Snapshot, 4, 0, "{\"hand\":[9]}")
        )
        .is_err());
    let action = envelope(
        &status,
        &match_id,
        Kind::Action,
        1,
        0,
        "{\"seat\":2,\"pass\":true}",
    );
    first
        .manager
        .send_party(&first_status.instance_id, None, action.clone())
        .unwrap();
    first
        .manager
        .send_party(&first_status.instance_id, None, action)
        .unwrap();
    wait(|| messages(&host).len() == 1);
    std::thread::sleep(Duration::from_millis(30));
    assert_eq!(messages(&host)[0].0, 1);
    assert_eq!(messages(&host).len(), 1);
    assert!(first
        .manager
        .send_party(
            &first_status.instance_id,
            Some(second_status.member_id),
            envelope(&status, &match_id, Kind::Action, 2, 0, "{}")
        )
        .is_err());
    let logs = serde_json::to_string(&host.logs.snapshot(0).operations).unwrap();
    assert!(logs.contains("send_frame") && logs.contains("receive_frame"));
    assert!(logs.contains("hand"));
    assert!(!logs.contains("test-room-code"));
    host.manager.leave();
    first.manager.leave();
    second.manager.leave();
    assert!(host.operations.wait_idle(Duration::ZERO));
    assert!(first.operations.wait_idle(Duration::ZERO));
    assert!(second.operations.wait_idle(Duration::ZERO));
}

#[test]
fn resume_rotates_credentials_rebinds_original_seat_and_supersedes_live_old_connection() {
    let host = Endpoint::new();
    let status = room(&host);
    let guest = Endpoint::new();
    let joined = join(&guest, &status, "first");
    wait(|| {
        guest
            .manager
            .party_status()
            .unwrap()
            .members
            .iter()
            .any(|m| m.member_id == joined.member_id)
    });
    let (old, input, device_id) = {
        let guard = guest.manager.party.runtime.lock();
        let shared = guard.as_ref().unwrap().shared.lock();
        (
            shared.recovery.clone().unwrap(),
            shared.join.clone().unwrap(),
            guest.manager.party.device_id.clone(),
        )
    };
    let resumed = guest.manager.resume_party(&joined.instance_id).unwrap();
    assert_eq!(resumed.member_id, joined.member_id);
    assert_eq!(resumed.seat, joined.seat);
    assert_eq!(resumed.instance_id, joined.instance_id);
    wait(|| {
        host.manager
            .party_status()
            .unwrap()
            .members
            .iter()
            .any(|m| m.member_id == joined.member_id && m.connection_generation == 2 && m.connected)
    });
    let current = {
        let guard = guest.manager.party.runtime.lock();
        let shared = guard.as_ref().unwrap().shared.lock();
        shared.recovery.clone().unwrap()
    };
    assert_ne!(old.recovery_token, current.recovery_token);
    let impostor = PartyManager {
        device_id,
        runtime: Mutex::new(None),
    };
    let operations = Arc::new(Operations::default());
    assert!(impostor
        .connect(
            input,
            Some(old.clone()),
            operations.begin().unwrap(),
            RoomDiagnostics::default(),
            Arc::new(|_| {}),
            uuid::Uuid::new_v4().to_string()
        )
        .is_err());
    let logs = serde_json::to_string(&host.logs.snapshot(0).operations).unwrap();
    assert!(!logs.contains(&old.recovery_token));
    assert!(!logs.contains(&current.recovery_token));
    assert!(logs.contains("[REDACTED]"));
    {
        let guard = guest.manager.party.runtime.lock();
        guard
            .as_ref()
            .unwrap()
            .shared
            .lock()
            .host_peer
            .as_ref()
            .unwrap()
            .shutdown();
    }
    wait(|| !guest.manager.party_status().unwrap().connected);
    assert_eq!(
        guest
            .manager
            .resume_party(&joined.instance_id)
            .unwrap()
            .seat,
        joined.seat
    );
    guest.manager.leave();
    host.manager.leave();
    assert!(operations.wait_idle(Duration::ZERO));
}

#[test]
fn room_capacity_versions_and_seat_configuration_are_enforced() {
    let host = Endpoint::new();
    let status = room(&host);
    let first = Endpoint::new();
    let second = Endpoint::new();
    let third = Endpoint::new();
    join(&first, &status, "first");
    join(&second, &status, "second");
    let input = GamePartyJoinInput {
        host: "127.0.0.1".into(),
        port: status.port,
        game_id: status.game_id,
        rules_version: 1,
        code: Some("test-room-code".into()),
        player_name: "third".into(),
    };
    assert!(third.manager.join_party(input.clone()).is_err());
    let mut incompatible = input;
    incompatible.rules_version = 2;
    assert!(third.manager.join_party(incompatible).is_err());
    assert!(host
        .manager
        .create_party(GamePartyCreateInput {
            game_id: "test".into(),
            rules_version: 1,
            seat_count: 3,
            remote_seats: vec![1, 1],
            room_name: "".into(),
            code: None,
            player_name: "".into()
        })
        .is_err());
    assert_eq!(host.manager.party_status().unwrap().room_id, status.room_id);
    first.manager.leave();
    second.manager.leave();
    host.manager.leave();
}

#[test]
fn revision_sequence_and_generation_reject_duplicates_with_changed_content_and_old_messages() {
    let host = Endpoint::new();
    let status = room(&host);
    let match_id = uuid::Uuid::new_v4().to_string();
    let start = envelope(&status, &match_id, Kind::Start, 1, 0, "{}");
    host.manager
        .send_party(&status.instance_id, None, start.clone())
        .unwrap();
    host.manager
        .send_party(&status.instance_id, None, start)
        .unwrap();
    let commit = envelope(&status, &match_id, Kind::Commit, 2, 1, "{}");
    host.manager
        .send_party(&status.instance_id, None, commit.clone())
        .unwrap();
    host.manager
        .send_party(&status.instance_id, None, commit.clone())
        .unwrap();
    let mut changed = commit;
    changed.payload = "{\"changed\":true}".into();
    assert!(host
        .manager
        .send_party(&status.instance_id, None, changed)
        .is_err());
    assert!(host
        .manager
        .send_party(
            &status.instance_id,
            None,
            envelope(&status, &match_id, Kind::Commit, 3, 3, "{}")
        )
        .is_err());
    assert!(host
        .manager
        .send_party(
            &status.instance_id,
            None,
            envelope(&status, &match_id, Kind::Start, 3, 0, "{}")
        )
        .is_err());
    let mut next = envelope(&status, &match_id, Kind::Start, 3, 0, "{}");
    next.generation = 2;
    host.manager
        .send_party(&status.instance_id, None, next)
        .unwrap();
    assert!(host
        .manager
        .send_party(
            &status.instance_id,
            None,
            envelope(&status, &match_id, Kind::Commit, 4, 1, "{}")
        )
        .is_err());
    host.manager.leave();
}
