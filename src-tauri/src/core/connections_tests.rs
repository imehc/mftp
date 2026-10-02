use super::Connections;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

fn pair() -> (TcpStream, TcpStream) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let client = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
    let (server, _) = listener.accept().unwrap();
    (client, server)
}

#[test]
fn workers_restore_blocking_io_for_nonblocking_accepted_sockets() {
    let mut connections = Connections::default();
    let (mut client, server) = pair();
    // Simulate inheritance on every test platform, including Linux.
    server.set_nonblocking(true).unwrap();
    server
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    let (started, ready) = mpsc::channel();
    let (done, result) = mpsc::channel();
    connections
        .spawn(server, move |mut stream| {
            started.send(()).unwrap();
            let mut byte = [0];
            done.send(stream.read_exact(&mut byte).map(|()| byte))
                .unwrap();
        })
        .unwrap();
    ready.recv_timeout(Duration::from_secs(2)).unwrap();
    assert!(matches!(
        result.recv_timeout(Duration::from_millis(50)),
        Err(mpsc::RecvTimeoutError::Timeout)
    ));
    client.write_all(b"x").unwrap();
    assert_eq!(
        result
            .recv_timeout(Duration::from_secs(2))
            .unwrap()
            .unwrap(),
        [b'x']
    );
}

#[test]
fn stop_wakes_idle_reads_and_backpressured_writes() {
    let mut connections = Connections::default();
    let (reader_client, reader_server) = pair();
    let (writer_client, writer_server) = pair();
    let (started, ready) = mpsc::channel();
    let (read_done, read_result) = mpsc::channel();
    let reader_started = started.clone();
    connections
        .spawn(reader_server, move |mut stream| {
            reader_started.send(()).unwrap();
            read_done.send(stream.read(&mut [0])).unwrap();
        })
        .unwrap();
    connections
        .spawn(writer_server, move |mut stream| {
            started.send(()).unwrap();
            while stream.write_all(&[1; 64 * 1024]).is_ok() {}
        })
        .unwrap();
    ready.recv_timeout(Duration::from_secs(2)).unwrap();
    ready.recv_timeout(Duration::from_secs(2)).unwrap();
    let (done, completed) = mpsc::channel();
    let stopper = thread::spawn(move || {
        drop(connections);
        done.send(()).unwrap();
    });
    completed.recv_timeout(Duration::from_secs(2)).unwrap();
    stopper.join().unwrap();
    assert!(matches!(read_result.recv().unwrap(), Ok(0) | Err(_)));
    drop((reader_client, writer_client));
}

#[test]
fn stop_waits_for_trailing_work_after_socket_shutdown() {
    let mut connections = Connections::default();
    let (client, server) = pair();
    let (awake, woke) = mpsc::channel();
    let (release, finish) = mpsc::channel();
    connections
        .spawn(server, move |mut stream| {
            let _ = stream.read(&mut [0]);
            awake.send(()).unwrap();
            // Model a file flush or database log after the interrupted network IO.
            finish.recv_timeout(Duration::from_secs(3)).unwrap();
        })
        .unwrap();
    let (done, completed) = mpsc::channel();
    let stopper = thread::spawn(move || {
        drop(connections);
        done.send(()).unwrap();
    });
    woke.recv_timeout(Duration::from_secs(2)).unwrap();
    assert!(completed.recv_timeout(Duration::from_millis(50)).is_err());
    release.send(()).unwrap();
    completed.recv_timeout(Duration::from_secs(2)).unwrap();
    stopper.join().unwrap();
    drop(client);
}

#[test]
fn reaping_finished_and_panicked_workers_preserves_live_connections() {
    let mut connections = Connections::default();
    let (client, server) = pair();
    connections
        .spawn(server, |mut stream| {
            let _ = stream.read(&mut [0]);
        })
        .unwrap();
    for panic in [false, true] {
        let (_client, server) = pair();
        connections
            .spawn(server, move |_| {
                assert!(!panic, "simulated handler panic");
            })
            .unwrap();
    }
    let deadline = Instant::now() + Duration::from_secs(2);
    while connections.active.len() != 1 {
        assert!(Instant::now() < deadline);
        connections.reap();
        thread::yield_now();
    }
    drop(connections);
    drop(client);
}
