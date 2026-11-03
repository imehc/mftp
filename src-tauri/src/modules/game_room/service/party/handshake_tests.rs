use super::*;
use crate::modules::game_room::service::{
    framing::{read_message, WireMsg, HANDSHAKE_FRAME_LIMIT},
    runtime::StopSignal,
};
use std::{io::BufReader, net::TcpStream};

struct Raw {
    peer: PeerLink,
    reader: BufReader<TcpStream>,
    stop: StopSignal,
}

impl Raw {
    fn new(status: &GamePartyStatus) -> Self {
        let stream = TcpStream::connect(("127.0.0.1", status.port)).unwrap();
        Self {
            peer: PeerLink::new(stream.try_clone().unwrap()).unwrap(),
            reader: BufReader::new(stream),
            stop: StopSignal::default(),
        }
    }

    fn read(&mut self) -> WireMsg {
        read_message(
            &mut self.reader,
            &self.stop,
            HANDSHAKE_FRAME_LIMIT,
            Duration::from_secs(2),
        )
        .unwrap()
    }

    fn hello(
        &mut self,
        status: &GamePartyStatus,
        device_id: &str,
        recovery: Option<Recovery>,
    ) -> (GamePartyStatus, String) {
        self.peer
            .send(&WireMsg::PartyHello {
                protocol_version: 3,
                game_id: status.game_id.clone(),
                rules_version: 1,
                code: Some("test-room-code".into()),
                player_name: "raw".into(),
                device_id: device_id.into(),
                recovery,
            })
            .unwrap();
        let WireMsg::PartyWelcome {
            status,
            recovery_token,
        } = self.read()
        else {
            panic!("Welcome expected")
        };
        (status, recovery_token)
    }
}

impl Drop for Raw {
    fn drop(&mut self) {
        self.peer.shutdown();
    }
}

fn credential_for(guest: &Endpoint) -> Recovery {
    guest
        .manager
        .party
        .runtime
        .lock()
        .as_ref()
        .unwrap()
        .shared
        .lock()
        .recovery
        .clone()
        .unwrap()
}

#[test]
fn repeated_lost_welcome_preserves_presented_credential_and_superseded_ack_cannot_activate_old_socket(
) {
    let host = Endpoint::new();
    let status = room(&host);
    let guest = Endpoint::new();
    let joined = join(&guest, &status, "guest");
    let old = credential_for(&guest);
    let device = &guest.manager.party.device_id;
    let mut first = Raw::new(&status);
    let (_, first_token) = first.hello(&status, device, Some(old.clone()));
    // The client never records this Welcome or acknowledges it.
    let mut second = Raw::new(&status);
    let (_, second_token) = second.hello(&status, device, Some(old.clone()));
    let _ = first.peer.send(&WireMsg::PartyAck {
        recovery_token: first_token,
    });
    second.peer.shutdown();
    wait(|| {
        host.manager
            .party_status()
            .unwrap()
            .members
            .iter()
            .any(|m| {
                m.member_id == joined.member_id && m.connection_generation == 3 && !m.connected
            })
    });
    assert_ne!(second_token, old.recovery_token);
    let resumed = guest.manager.resume_party(&joined.instance_id).unwrap();
    assert_eq!(
        (resumed.member_id.as_str(), resumed.seat),
        (joined.member_id.as_str(), joined.seat)
    );
    wait(|| {
        host.manager
            .party_status()
            .unwrap()
            .members
            .iter()
            .any(|m| m.member_id == joined.member_id && m.connection_generation == 4 && m.connected)
    });
    let logs = serde_json::to_string(&host.logs.snapshot(0).operations).unwrap();
    assert!(!logs.contains(&old.recovery_token));
    assert!(!logs.contains(&second_token));
    guest.manager.leave();
    host.manager.leave();
}

#[test]
fn incomplete_new_join_releases_seat_and_explicit_leave_allows_new_identity() {
    let host = Endpoint::new();
    let status = room(&host);
    let mut incomplete = Raw::new(&status);
    let (pending, _) = incomplete.hello(&status, &uuid::Uuid::new_v4().to_string(), None);
    incomplete.peer.shutdown();
    wait(|| {
        !host
            .manager
            .party_status()
            .unwrap()
            .members
            .iter()
            .any(|m| m.member_id == pending.member_id)
    });
    let first = Endpoint::new();
    let first_status = join(&first, &status, "first");
    assert_eq!(first_status.seat, 1);
    first.manager.leave();
    wait(|| {
        !host
            .manager
            .party_status()
            .unwrap()
            .members
            .iter()
            .any(|m| m.member_id == first_status.member_id)
    });
    let second = Endpoint::new();
    let second_status = join(&second, &status, "second");
    assert_eq!(second_status.seat, 1);
    assert_ne!(second_status.member_id, first_status.member_id);
    second.manager.leave();
    host.manager.leave();
}

#[test]
fn old_client_handshake_and_wrong_device_recovery_are_rejected() {
    let host = Endpoint::new();
    let status = room(&host);
    let mut legacy = Raw::new(&status);
    legacy
        .peer
        .send(&WireMsg::Hello {
            game_id: status.game_id.clone(),
            code: Some("test-room-code".into()),
            player_name: "old".into(),
        })
        .unwrap();
    assert!(matches!(legacy.read(), WireMsg::Reject { reason } if reason == "version-mismatch"));
    let guest = Endpoint::new();
    join(&guest, &status, "guest");
    let mut wrong = Raw::new(&status);
    wrong
        .peer
        .send(&WireMsg::PartyHello {
            protocol_version: 3,
            game_id: status.game_id.clone(),
            rules_version: 1,
            code: None,
            player_name: "wrong".into(),
            device_id: uuid::Uuid::new_v4().to_string(),
            recovery: Some(credential_for(&guest)),
        })
        .unwrap();
    assert!(matches!(wrong.read(), WireMsg::Reject { .. }));
    guest.manager.leave();
    host.manager.leave();
}

#[test]
fn lost_ready_retains_rotated_credential_in_client_runtime_for_explicit_recovery() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let host = Endpoint::new();
    let mut status = room(&host);
    status.port = port;
    status.hosting = false;
    status.member_id = uuid::Uuid::new_v4().to_string();
    status.seat = 1;
    status.connection_generation = 1;
    status.code = None;
    let token = credential();
    let expected = token.clone();
    let fake = std::thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        let peer = PeerLink::new(stream.try_clone().unwrap()).unwrap();
        let stop = StopSignal::default();
        let mut reader = BufReader::new(stream);
        assert!(matches!(
            read_message(
                &mut reader,
                &stop,
                HANDSHAKE_FRAME_LIMIT,
                Duration::from_secs(2)
            )
            .unwrap(),
            WireMsg::PartyHello { .. }
        ));
        peer.send(&WireMsg::PartyWelcome {
            status,
            recovery_token: token.clone(),
        })
        .unwrap();
        assert!(
            matches!(read_message(&mut reader, &stop, HANDSHAKE_FRAME_LIMIT, Duration::from_secs(2)).unwrap(), WireMsg::PartyAck { recovery_token } if recovery_token == token)
        );
        peer.shutdown();
    });
    let guest = Endpoint::new();
    let error = guest.manager.join_party(GamePartyJoinInput {
        host: "127.0.0.1".into(),
        port,
        game_id: "hidden-test".into(),
        rules_version: 1,
        code: None,
        player_name: "guest".into(),
    });
    assert!(error.is_err());
    fake.join().unwrap();
    assert!(!guest.manager.party_status().unwrap().connected);
    assert_eq!(credential_for(&guest).recovery_token, expected);
    guest.manager.leave();
    host.manager.leave();
    assert!(guest.operations.wait_idle(Duration::ZERO));
}

#[test]
fn envelope_bounds_unknown_fields_and_private_delivery_policy_are_checked() {
    let host = Endpoint::new();
    let status = room(&host);
    let id = uuid::Uuid::new_v4().to_string();
    let valid = envelope(&status, &id, Kind::Start, 1, 0, "{}");
    let mut invalid = valid.clone();
    invalid.generation = 0;
    assert!(protocol::validate(&invalid, &status.room_id, 1).is_err());
    invalid = valid.clone();
    invalid.payload = "[]".into();
    assert!(protocol::validate(&invalid, &status.room_id, 1).is_err());
    invalid.payload = format!("{{\"data\":\"{}\"}}", "x".repeat(128 * 1024));
    assert!(protocol::validate(&invalid, &status.room_id, 1).is_err());
    let mut json = serde_json::to_value(&valid).unwrap();
    json["unknown"] = serde_json::json!(true);
    assert!(serde_json::from_value::<GamePartyEnvelope>(json).is_err());
    assert!(host
        .manager
        .send_party(&status.instance_id, Some("guest".into()), valid.clone())
        .is_err());
    let mut action = valid;
    action.kind = Kind::Action;
    assert!(host
        .manager
        .send_party(&status.instance_id, None, action)
        .is_err());
    host.manager.leave();
}

#[test]
fn stale_revision_allows_snapshot_request_but_not_replayed_action() {
    let host = Endpoint::new();
    let status = room(&host);
    let id = uuid::Uuid::new_v4().to_string();
    let mut position = protocol::Position::default();
    position
        .advance(&envelope(&status, &id, Kind::Start, 1, 0, "{}"))
        .unwrap();
    position
        .advance(&envelope(&status, &id, Kind::Commit, 2, 1, "{}"))
        .unwrap();
    assert!(position
        .check_action(&envelope(
            &status,
            &id,
            Kind::Request,
            3,
            0,
            "{\"type\":\"snapshot\"}"
        ))
        .is_ok());
    assert!(position
        .check_action(&envelope(&status, &id, Kind::Action, 3, 0, "{}"))
        .is_err());
    host.manager.leave();
}
