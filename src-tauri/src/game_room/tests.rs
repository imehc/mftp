use super::discovery::{probe_room, BASE_PORT, PORT_SPAN};
use super::{GameRoomManager, RoomEvent};
use std::net::SocketAddr;
use std::sync::mpsc;
use std::sync::Arc;
use std::time::{Duration, Instant};

fn manager() -> (GameRoomManager, mpsc::Receiver<RoomEvent>) {
    let (tx, rx) = mpsc::channel();
    let mgr = GameRoomManager::new(Arc::new(move |event| {
        let _ = tx.send(event);
    }));
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
fn handshake_relay_and_rejoin() {
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
    assert!(err.contains("房间码"), "unexpected error: {err}");
    let err = join(&guest, "chess", "1234", "客人").unwrap_err();
    assert!(err.contains("类型"), "unexpected error: {err}");

    let joined = join(&guest, "gomoku", "1234", "客人").unwrap();
    assert_eq!(joined.seat, Some(1));
    assert_eq!(joined.peer_name.as_deref(), Some("主机"));
    wait_event(&host_rx, "peer joined", |e| {
        matches!(e, RoomEvent::PeerJoined { name } if name == "客人")
    });

    let (third, _third_rx) = manager();
    let err = join(&third, "gomoku", "1234", "第三人").unwrap_err();
    assert!(err.contains("已满"), "unexpected error: {err}");

    host.send("{\"t\":\"move\",\"seq\":0}".into()).unwrap();
    wait_event(&guest_rx, "guest message", |e| {
        matches!(e, RoomEvent::Message { payload } if payload.contains("\"seq\":0"))
    });
    guest.send("{\"t\":\"undo-request\"}".into()).unwrap();
    wait_event(&host_rx, "host message", |e| {
        matches!(e, RoomEvent::Message { payload } if payload.contains("undo-request"))
    });

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
    let (host, _host_rx) = manager();
    host.create("gomoku".into(), "发现测试".into(), None, "主机".into())
        .unwrap();
    let (seeker, _seeker_rx) = manager();
    let deadline = Instant::now() + Duration::from_secs(8);
    let mut found = false;
    while Instant::now() < deadline {
        if seeker
            .discover("gomoku")
            .iter()
            .any(|room| room.room_name == "发现测试")
        {
            found = true;
            break;
        }
    }
    assert!(found, "room not discovered");
    assert!(seeker
        .discover("chess")
        .iter()
        .all(|room| room.room_name != "发现测试"));
    host.leave();
}

#[test]
fn probe_answers_without_consuming_the_seat() {
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
    assert_eq!(room.room_name, "探测房");
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
