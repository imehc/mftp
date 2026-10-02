use super::*;
use std::net::{Shutdown, TcpListener};
use std::sync::Arc;
use std::thread;

fn sockets() -> (TcpStream, TcpStream) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let client = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
    let (server, _) = listener.accept().unwrap();
    (client, server)
}

#[test]
fn encoding_counts_escaped_bytes_and_delimiter_without_losing_size_error() {
    let overhead = encode(&WireMsg::App {
        payload: String::new(),
    })
    .unwrap()
    .len();
    let exact = WireMsg::App {
        payload: "x".repeat(MESSAGE_FRAME_LIMIT - overhead),
    };
    assert_eq!(encode(&exact).unwrap().len(), MESSAGE_FRAME_LIMIT);
    for payload in [
        "x".repeat(MESSAGE_FRAME_LIMIT - overhead + 1),
        "\0".repeat(MESSAGE_FRAME_LIMIT / 6),
    ] {
        let error = encode(&WireMsg::App { payload }).unwrap_err();
        assert_eq!(error, frame_too_large(MESSAGE_FRAME_LIMIT));
        assert_eq!(AppError::from(io::Error::other(error.clone())), error);
    }
    assert_eq!(
        encode(&WireMsg::Hello {
            game_id: "game".into(),
            code: None,
            player_name: "\0".repeat(HANDSHAKE_FRAME_LIMIT / 6),
        })
        .unwrap_err(),
        frame_too_large(HANDSHAKE_FRAME_LIMIT)
    );
    let mut buffer = FrameBuffer {
        bytes: vec![b'x'; 3],
        limit: 3,
        exceeded: false,
    };
    assert_eq!(
        AppError::from(buffer.write_all(b"\n").unwrap_err()),
        frame_too_large(3)
    );
    assert_eq!(buffer.bytes.len(), 3);
}

#[test]
fn reads_fragmented_utf8_and_preserves_pipelined_frames() {
    let (mut client, server) = sockets();
    let frames = [
        encode(&WireMsg::App {
            payload: "玩家\n\0".into(),
        })
        .unwrap(),
        encode(&WireMsg::Ping).unwrap(),
    ]
    .concat();
    let sender = thread::spawn(move || {
        for chunk in frames.chunks(2) {
            client.write_all(chunk).unwrap();
        }
    });
    let mut reader = BufReader::with_capacity(3, server);
    let stop = StopSignal::default();
    assert!(
        matches!(read_message(&mut reader, &stop, MESSAGE_FRAME_LIMIT, Duration::from_secs(1)).unwrap(), WireMsg::App { payload } if payload == "玩家\n\0")
    );
    assert!(matches!(
        read_message(
            &mut reader,
            &stop,
            MESSAGE_FRAME_LIMIT,
            Duration::from_secs(1)
        )
        .unwrap(),
        WireMsg::Ping
    ));
    sender.join().unwrap();
}

#[test]
fn reading_requires_delimiter_and_rejects_invalid_json_and_utf8() {
    for (bytes, code) in [
        (&b"{\"type\":\"ping\"}"[..], "io:unexpected_eof"),
        (&b"{\"type\":\"ping\"\n"[..], "json:eof"),
        (
            &b"{\"type\":\"app\",\"payload\":\"\xff\"}\n"[..],
            "json:parse",
        ),
    ] {
        let (mut client, server) = sockets();
        client.write_all(bytes).unwrap();
        client.shutdown(Shutdown::Write).unwrap();
        let error = read_message(
            &mut BufReader::new(server),
            &StopSignal::default(),
            MESSAGE_FRAME_LIMIT,
            Duration::from_secs(1),
        )
        .err()
        .unwrap();
        assert_eq!(error.code, code);
    }
}

#[test]
fn receive_limit_includes_delimiter_and_rejects_unterminated_limit() {
    let frame = encode(&WireMsg::Ping).unwrap();
    for (bytes, limit, succeeds) in [
        (frame.clone(), frame.len(), true),
        (frame.clone(), frame.len() - 1, false),
        (vec![b' '; frame.len()], frame.len(), false),
    ] {
        let (mut client, server) = sockets();
        client.write_all(&bytes).unwrap();
        let result = read_message(
            &mut BufReader::new(server),
            &StopSignal::default(),
            limit,
            Duration::from_secs(1),
        );
        if succeeds {
            assert!(matches!(result.unwrap(), WireMsg::Ping));
        } else {
            assert_eq!(result.err().unwrap(), frame_too_large(limit));
        }
    }
}

#[test]
fn dripping_bytes_cannot_renew_frame_deadline() {
    let (mut client, server) = sockets();
    let sender = thread::spawn(move || {
        for _ in 0..100 {
            if client.write_all(b" ").is_err() {
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }
    });
    let start = Instant::now();
    let error = read_message(
        &mut BufReader::new(server),
        &StopSignal::default(),
        MESSAGE_FRAME_LIMIT,
        Duration::from_millis(150),
    )
    .err()
    .unwrap();
    assert_eq!(error.code, "io:timed_out");
    assert!(start.elapsed() < Duration::from_secs(1));
    sender.join().unwrap();
}

#[test]
fn stop_signal_interrupts_an_idle_frame_read() {
    let (_client, server) = sockets();
    let stop = Arc::new(StopSignal::default());
    let worker_stop = stop.clone();
    let reader = thread::spawn(move || {
        read_message(
            &mut BufReader::new(server),
            &worker_stop,
            MESSAGE_FRAME_LIMIT,
            Duration::from_secs(10),
        )
    });
    thread::sleep(Duration::from_millis(30));
    let start = Instant::now();
    stop.stop();
    assert_eq!(
        reader.join().unwrap().err().unwrap().code,
        "io:connection_aborted"
    );
    assert!(start.elapsed() < Duration::from_secs(1));
}

#[test]
fn backpressured_writes_obey_the_total_deadline() {
    let (_client, mut server) = sockets();
    // Exercise the IO loop directly with enough bytes to fill any normal socket
    // buffer; public message sends still enforce their smaller frame limit.
    let start = Instant::now();
    let error = write_frame(
        &mut server,
        &vec![b'x'; 32 * 1024 * 1024],
        start + Duration::from_millis(150),
    )
    .unwrap_err();
    assert!(matches!(
        error.kind(),
        io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock
    ));
    assert!(start.elapsed() < Duration::from_secs(1));
}
