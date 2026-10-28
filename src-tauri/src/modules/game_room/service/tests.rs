use super::discovery::{probe_room, BASE_PORT, PORT_SPAN};
use super::{GameRoomManager, RoomEvent};
use std::net::SocketAddr;
use std::sync::mpsc;
use std::sync::Arc;
use std::time::{Duration, Instant};

// These integration tests share a fixed discovery port range and mDNS namespace.
// Serialize their room fixtures rather than consuming each other's probe ports.
static ROOM_NETWORK: std::sync::Mutex<()> = std::sync::Mutex::new(());
pub(super) fn network_guard() -> std::sync::MutexGuard<'static, ()> {
    ROOM_NETWORK
        .lock()
        .unwrap_or_else(|error| error.into_inner())
}

fn manager() -> (GameRoomManager, mpsc::Receiver<RoomEvent>) {
    let (tx, rx) = mpsc::channel();
    let mgr = GameRoomManager::new(
        Arc::new(move |_, event| {
            let _ = tx.send(event);
        }),
        Arc::new(crate::core::operations::Operations::default()),
    );
    (mgr, rx)
}

fn wait_event(
    rx: &mpsc::Receiver<RoomEvent>,
    what: &str,
    pred: impl Fn(&RoomEvent) -> bool,
) -> RoomEvent {
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        if let Ok(event) = rx.recv_timeout(Duration::from_millis(200)) {
            if pred(&event) {
                return event;
            }
        }
    }
    panic!("timed out waiting for {what}");
}

#[test]
fn reversi_room_isolates_game_and_relays_moves_and_negotiations() {
    let _network = network_guard();
    let (host, host_rx) = manager();
    let (guest, guest_rx) = manager();
    let game = "reversi/online-v2";
    let room = host
        .create(
            game.into(),
            "Reversi test".into(),
            Some("4826".into()),
            "Host".into(),
        )
        .unwrap();
    let port = room.port.unwrap();
    let wrong_game = guest
        .join(
            "127.0.0.1".into(),
            port,
            "gomoku/online-v2".into(),
            Some("4826".into()),
            "Guest".into(),
        )
        .unwrap_err();
    assert_eq!(wrong_game.code, "room:game_mismatch");
    let wrong_code = guest
        .join(
            "127.0.0.1".into(),
            port,
            game.into(),
            Some("0000".into()),
            "Guest".into(),
        )
        .unwrap_err();
    assert_eq!(wrong_code.code, "room:code_invalid");
    let joined = guest
        .join(
            "127.0.0.1".into(),
            port,
            game.into(),
            Some("4826".into()),
            "Guest".into(),
        )
        .unwrap();
    assert_eq!(joined.seat, Some(1));
    wait_event(&host_rx, "reversi peer", |event| {
        matches!(event, RoomEvent::PeerJoined { .. })
    });

    // The room transports exact frontend envelopes; Reversi legality is tested in TypeScript.
    let frames = [
        r#"{"t":"move","v":2,"round":0,"revision":0,"seq":0,"seat":0,"move":{"row":2,"col":3},"stateHash":"board-hash"}"#,
        r#"{"t":"undo-request","v":2,"round":0,"revision":0,"requestId":1,"atMove":1,"plies":1,"stateHash":"board-hash"}"#,
        r#"{"t":"undo-response","v":2,"round":0,"revision":0,"requestId":1,"atMove":1,"accept":true}"#,
        r#"{"t":"rematch-request","v":2,"round":0,"revision":1,"requestId":2,"atMove":60,"stateHash":"final-hash"}"#,
    ];
    for (index, frame) in frames.iter().enumerate() {
        let (sender, receiver) = if index % 2 == 0 {
            (&host, &guest_rx)
        } else {
            (&guest, &host_rx)
        };
        sender
            .send(
                sender.status().instance_id.as_deref().unwrap(),
                (*frame).into(),
            )
            .unwrap();
        wait_event(
            receiver,
            "exact reversi envelope",
            |event| matches!(event, RoomEvent::Message { payload } if payload == frame),
        );
    }
    guest.leave();
    wait_event(&host_rx, "reversi departure", |event| {
        matches!(event, RoomEvent::PeerLeft)
    });
    host.leave();
}

#[test]
fn handshake_relay_and_rejoin() {
    let _network = network_guard();
    let (host, host_rx) = manager();
    let (guest, guest_rx) = manager();
    let status = host
        .create(
            "gomoku".into(),
            "测试房".into(),
            Some("1234".into()),
            "主机".into(),
        )
        .unwrap();
    let port = status.port.unwrap();
    let join = |mgr: &GameRoomManager, game: &str, code: &str, name: &str| {
        mgr.join(
            "127.0.0.1".into(),
            port,
            game.into(),
            Some(code.into()),
            name.into(),
        )
    };

    let err = join(&guest, "gomoku", "0000", "客人").unwrap_err();
    assert!(err.code == "room:code_invalid", "unexpected error: {err}");
    let err = join(&guest, "chess", "1234", "客人").unwrap_err();
    assert!(err.code == "room:game_mismatch", "unexpected error: {err}");

    let joined = join(&guest, "gomoku", "1234", "客人").unwrap();
    assert_eq!(joined.seat, Some(1));
    assert_eq!(joined.peer_name.as_deref(), Some("主机"));
    wait_event(
        &host_rx,
        "peer joined",
        |e| matches!(e, RoomEvent::PeerJoined { name } if name == "客人"),
    );

    let (third, _third_rx) = manager();
    let err = join(&third, "gomoku", "1234", "第三人").unwrap_err();
    assert!(err.code == "room:full", "unexpected error: {err}");

    host.send(
        host.status().instance_id.as_deref().unwrap_or("stale"),
        "{\"t\":\"move\",\"seq\":0}".into(),
    )
    .unwrap();
    wait_event(
        &guest_rx,
        "guest message",
        |e| matches!(e, RoomEvent::Message { payload } if payload.contains("\"seq\":0")),
    );
    guest
        .send(
            guest.status().instance_id.as_deref().unwrap_or("stale"),
            "{\"t\":\"undo-request\"}".into(),
        )
        .unwrap();
    wait_event(
        &host_rx,
        "host message",
        |e| matches!(e, RoomEvent::Message { payload } if payload.contains("undo-request")),
    );

    guest.leave();
    wait_event(&host_rx, "peer left", |e| matches!(e, RoomEvent::PeerLeft));
    let rejoined = join(&guest, "gomoku", "1234", "客人").unwrap();
    assert_eq!(rejoined.seat, Some(1));
    wait_event(&host_rx, "peer rejoined", |e| {
        matches!(e, RoomEvent::PeerJoined { .. })
    });

    host.leave();
    wait_event(&guest_rx, "room closed", |e| {
        matches!(e, RoomEvent::Closed { .. })
    });
    guest.leave();
}

#[test]
fn discover_filters_by_game() {
    let _network = network_guard();
    let (host, _host_rx) = manager();
    host.create("gomoku".into(), "发现测试".into(), None, "主机".into())
        .unwrap();
    let (seeker, _seeker_rx) = manager();
    let deadline = Instant::now() + Duration::from_secs(8);
    let mut found = false;
    while Instant::now() < deadline {
        if seeker
            .discover("gomoku")
            .unwrap()
            .iter()
            .any(|room| room.room_name.as_deref() == Some("发现测试"))
        {
            found = true;
            break;
        }
    }
    assert!(found, "room not discovered");
    assert!(seeker
        .discover("chess")
        .unwrap()
        .iter()
        .all(|room| room.room_name.as_deref() != Some("发现测试")));
    host.leave();
}

#[test]
fn probe_answers_without_consuming_the_seat() {
    let _network = network_guard();
    let (host, _host_rx) = manager();
    let status = host
        .create(
            "gomoku".into(),
            "探测房".into(),
            Some("9".into()),
            "主机".into(),
        )
        .unwrap();
    let port = status.port.unwrap();
    assert!(
        (BASE_PORT..BASE_PORT + PORT_SPAN).contains(&port),
        "room should bind the fixed discovery range, got {port}"
    );

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let room = probe_room(addr).expect("probe should answer with a room card");
    assert_eq!(room.room_name.as_deref(), Some("探测房"));
    assert_eq!(room.game_id, "gomoku");
    assert!(room.has_code);
    // Probing twice must not occupy the guest slot…
    assert!(probe_room(addr).is_some());
    // …so a real join still succeeds afterwards.
    let (guest, _guest_rx) = manager();
    let joined = guest
        .join(
            "127.0.0.1".into(),
            port,
            "gomoku".into(),
            Some("9".into()),
            "客人".into(),
        )
        .unwrap();
    assert_eq!(joined.seat, Some(1));
    host.leave();
    guest.leave();
}
