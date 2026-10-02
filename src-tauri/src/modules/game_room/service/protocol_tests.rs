use super::framing::{
    encode, frame_too_large, read_message, HANDSHAKE_FRAME_LIMIT, MESSAGE_FRAME_LIMIT,
};
use super::*;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

fn manager() -> (GameRoomManager, mpsc::Receiver<RoomEvent>) {
    let (events, received) = mpsc::channel();
    let manager = GameRoomManager::new(
        Arc::new(move |_, event| {
            let _ = events.send(event);
        }),
        Arc::new(Operations::default()),
    );
    (manager, received)
}

fn create(manager: &GameRoomManager) -> GameRoomStatus {
    manager
        .create("gomoku".into(), "room".into(), None, "host".into())
        .unwrap()
}

fn connect(port: u16) -> TcpStream {
    let stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(3)))
        .unwrap();
    stream
        .set_write_timeout(Some(Duration::from_secs(3)))
        .unwrap();
    stream
}

fn hello() -> Vec<u8> {
    encode(&WireMsg::Hello {
        game_id: "gomoku".into(),
        code: None,
        player_name: "guest".into(),
    })
    .unwrap()
}

fn welcome() -> Vec<u8> {
    encode(&WireMsg::Welcome {
        room_id: "room".into(),
        room_name: "test".into(),
        peer_name: "host".into(),
    })
    .unwrap()
}

fn handshake(stream: &mut TcpStream) {
    stream.write_all(&hello()).unwrap();
    let mut line = String::new();
    BufReader::new(stream).read_line(&mut line).unwrap();
    assert!(matches!(
        serde_json::from_str::<WireMsg>(&line).unwrap(),
        WireMsg::Welcome { .. }
    ));
}

fn event(received: &mpsc::Receiver<RoomEvent>) -> RoomEvent {
    received.recv_timeout(Duration::from_secs(3)).unwrap()
}

fn fake_host(reply: Vec<u8>) -> (u16, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let worker = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_write_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let mut reader = BufReader::new(stream.try_clone().unwrap());
        assert!(matches!(
            read_message(
                &mut reader,
                &StopSignal::default(),
                HANDSHAKE_FRAME_LIMIT,
                Duration::from_secs(2)
            )
            .unwrap(),
            WireMsg::Hello { .. }
        ));
        let _ = stream.write_all(&reply);
    });
    (port, worker)
}

#[test]
fn host_rejects_invalid_or_incomplete_handshakes_without_taking_the_seat() {
    let _network = super::tests::network_guard();
    let (host, received) = manager();
    let port = create(&host).port.unwrap();
    let mut incomplete = hello();
    incomplete.pop();
    for bytes in [
        incomplete,
        vec![b' '; HANDSHAKE_FRAME_LIMIT + 1],
        b"\xff\n".to_vec(),
        encode(&WireMsg::App {
            payload: "early".into(),
        })
        .unwrap(),
    ] {
        let mut stream = connect(port);
        let _ = stream.write_all(&bytes);
        let _ = stream.shutdown(Shutdown::Write);
        let mut response = Vec::new();
        let _ = stream.read_to_end(&mut response);
        assert!(host.status().peer_name.is_none());
        assert!(received.try_recv().is_err());
    }
    let mut guest = connect(port);
    handshake(&mut guest);
    assert!(matches!(event(&received), RoomEvent::PeerJoined { .. }));
}

#[test]
fn malformed_oversized_or_out_of_phase_game_frames_disconnect_and_allow_rejoin() {
    let _network = super::tests::network_guard();
    let (host, received) = manager();
    let port = create(&host).port.unwrap();
    let incomplete = b"{\"type\":\"app\",\"payload\":\"no-delimiter\"}".to_vec();
    for bytes in [
        incomplete,
        vec![b' '; MESSAGE_FRAME_LIMIT + 1],
        b"{broken}\n".to_vec(),
        hello(),
        encode(&WireMsg::Probe).unwrap(),
    ] {
        let mut stream = connect(port);
        handshake(&mut stream);
        assert!(matches!(event(&received), RoomEvent::PeerJoined { .. }));
        let _ = stream.write_all(&bytes);
        let _ = stream.shutdown(Shutdown::Write);
        assert!(matches!(event(&received), RoomEvent::PeerLeft));
        assert!(host.status().peer_name.is_none());
        assert!(received.try_recv().is_err());
    }
    let mut guest = connect(port);
    handshake(&mut guest);
    assert!(matches!(event(&received), RoomEvent::PeerJoined { .. }));
    guest
        .write_all(
            &encode(&WireMsg::App {
                payload: "still-usable".into(),
            })
            .unwrap(),
        )
        .unwrap();
    assert!(
        matches!(event(&received), RoomEvent::Message { payload } if payload == "still-usable")
    );
}

#[test]
fn guest_rejects_bad_welcome_and_releases_failed_join_resources() {
    let mut incomplete = welcome();
    incomplete.pop();
    for (reply, expected) in [
        (incomplete, "io:unexpected_eof"),
        (
            vec![b' '; HANDSHAKE_FRAME_LIMIT + 1],
            "room:frame_too_large",
        ),
        (b"{broken}\n".to_vec(), "json:parse"),
        (encode(&WireMsg::Ping).unwrap(), "room:handshake_invalid"),
    ] {
        let (guest, _received) = manager();
        let (port, worker) = fake_host(reply);
        let error = guest
            .join(
                "127.0.0.1".into(),
                port,
                "gomoku".into(),
                None,
                "guest".into(),
            )
            .unwrap_err();
        assert_eq!(error.code, expected);
        assert_eq!(guest.status().phase, "idle");
        assert!(guest.operations.wait_idle(Duration::ZERO));
        worker.join().unwrap();
    }
}

#[test]
fn guest_keeps_message_pipelined_with_welcome_and_closes_on_invalid_next_frame() {
    let (guest, received) = manager();
    let opaque = "opaque\n\0玩家";
    let reply = [
        welcome(),
        encode(&WireMsg::App {
            payload: opaque.into(),
        })
        .unwrap(),
        hello(),
        encode(&WireMsg::App {
            payload: "must-not-arrive".into(),
        })
        .unwrap(),
    ]
    .concat();
    let (port, worker) = fake_host(reply);
    guest
        .join(
            "127.0.0.1".into(),
            port,
            "gomoku".into(),
            None,
            "guest".into(),
        )
        .unwrap();
    assert!(matches!(event(&received), RoomEvent::Message { payload } if payload == opaque));
    assert!(matches!(
        event(&received),
        RoomEvent::Closed {
            reason: GameRoomClosedReason::ConnectionLost
        }
    ));
    assert!(received.try_recv().is_err());
    guest.leave();
    assert!(guest.operations.wait_idle(Duration::ZERO));
    worker.join().unwrap();
}

#[test]
fn oversized_local_send_writes_nothing_and_preserves_the_peer() {
    let _network = super::tests::network_guard();
    let (host, received) = manager();
    let mut socket = connect(create(&host).port.unwrap());
    handshake(&mut socket);
    assert!(matches!(event(&received), RoomEvent::PeerJoined { .. }));
    assert_eq!(
        host.send(
            host.status().instance_id.as_deref().unwrap_or("stale"),
            "\0".repeat(MESSAGE_FRAME_LIMIT / 6)
        )
        .unwrap_err(),
        frame_too_large(MESSAGE_FRAME_LIMIT)
    );
    host.send(
        host.status().instance_id.as_deref().unwrap_or("stale"),
        "small".into(),
    )
    .unwrap();
    let message = read_message(
        &mut BufReader::new(socket),
        &StopSignal::default(),
        MESSAGE_FRAME_LIMIT,
        Duration::from_secs(2),
    )
    .unwrap();
    assert!(matches!(message, WireMsg::App { payload } if payload == "small"));
}

#[test]
fn oversized_local_metadata_does_not_replace_a_working_room() {
    let _network = super::tests::network_guard();
    let (host, _) = manager();
    let original = create(&host);
    let escaped = "\0".repeat(HANDSHAKE_FRAME_LIMIT / 6);
    assert_eq!(
        host.create("gomoku".into(), escaped.clone(), None, "host".into())
            .unwrap_err(),
        frame_too_large(HANDSHAKE_FRAME_LIMIT)
    );
    assert_eq!(
        host.join(
            "127.0.0.1".into(),
            original.port.unwrap(),
            "gomoku".into(),
            Some(escaped),
            "guest".into()
        )
        .unwrap_err(),
        frame_too_large(HANDSHAKE_FRAME_LIMIT)
    );
    assert_eq!(host.status().room_id, original.room_id);
    assert_eq!(host.status().port, original.port);
}

#[test]
fn real_listener_bounds_a_dripping_handshake_and_remains_joinable() {
    let _network = super::tests::network_guard();
    let (host, received) = manager();
    let port = create(&host).port.unwrap();
    let mut stream = connect(port);
    stream
        .set_read_timeout(Some(Duration::from_secs(6)))
        .unwrap();
    let mut writer = stream.try_clone().unwrap();
    let sender = thread::spawn(move || {
        for _ in 0..300 {
            if writer.write_all(b" ").is_err() {
                break;
            }
            thread::sleep(Duration::from_millis(20));
        }
    });
    let start = Instant::now();
    let mut response = String::new();
    BufReader::new(&mut stream)
        .read_line(&mut response)
        .unwrap();
    assert!(matches!(
        serde_json::from_str::<WireMsg>(&response).unwrap(),
        WireMsg::Reject { .. }
    ));
    assert!(start.elapsed() < Duration::from_secs(6));
    let _ = stream.shutdown(Shutdown::Both);
    sender.join().unwrap();
    assert!(received.try_recv().is_err());
    let mut valid = connect(port);
    handshake(&mut valid);
    assert!(matches!(event(&received), RoomEvent::PeerJoined { .. }));
}

#[test]
fn failed_partial_send_shuts_down_socket_before_any_following_frame() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let mut client = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
    client
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    let (server, _) = listener.accept().unwrap();
    let peer = PeerLink::new(server).unwrap();
    let worker = thread::spawn(move || {
        let frame = WireMsg::App {
            payload: "x".repeat(128 * 1024),
        };
        let error = (0..128).try_for_each(|_| peer.send(&frame)).unwrap_err();
        assert!(matches!(
            error.code.as_str(),
            "io:timed_out" | "io:would_block"
        ));
        assert!(peer
            .send(&WireMsg::App {
                payload: "must-not-follow".into()
            })
            .is_err());
        // Keep the PeerLink alive until the reader proves shutdown, not just Drop.
        peer
    });
    let peer = worker.join().unwrap();
    let mut bytes = Vec::new();
    client.read_to_end(&mut bytes).unwrap();
    assert!(!String::from_utf8_lossy(&bytes).contains("must-not-follow"));
    drop(peer);
}
