use super::*;
use crate::core::activity::{ActivitySink, OperationContext};
use crate::core::execution::Executor;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

fn manager(operations: Arc<Operations>) -> Arc<GameRoomManager> {
    Arc::new(GameRoomManager::new(Arc::new(|_, _| {}), operations))
}

fn create(manager: &GameRoomManager) -> GameRoomStatus {
    manager
        .create("gomoku".into(), "room".into(), None, "host".into())
        .unwrap()
}

fn wait_for(mut condition: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(3);
    while !condition() {
        assert!(Instant::now() < deadline);
        thread::sleep(Duration::from_millis(5));
    }
}

fn connect(port: u16) -> TcpStream {
    let stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    stream
        .set_write_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    stream
}

fn handshake(stream: &mut TcpStream) {
    let hello = serde_json::to_string(&WireMsg::Hello {
        game_id: "gomoku".into(),
        code: None,
        player_name: "guest".into(),
    })
    .unwrap();
    stream.write_all(hello.as_bytes()).unwrap();
    stream.write_all(b"\n").unwrap();
    let mut welcome = String::new();
    BufReader::new(stream).read_line(&mut welcome).unwrap();
    assert!(matches!(
        serde_json::from_str::<WireMsg>(&welcome).unwrap(),
        WireMsg::Welcome { .. }
    ));
}

#[tokio::test]
async fn runtime_blocks_maintenance_until_leave_and_can_restart_but_not_after_shutdown() {
    let _network = super::tests::network_guard();
    let operations = Arc::new(Operations::default());
    let manager = manager(operations.clone());
    let first = create(&manager);
    assert_eq!(
        operations
            .maintenance(Duration::ZERO)
            .await
            .err()
            .unwrap()
            .code,
        "app:operations_busy"
    );
    manager.leave();
    manager.leave();
    assert_eq!(manager.status().phase, "idle");
    assert!(TcpStream::connect(("127.0.0.1", first.port.unwrap())).is_err());
    let maintenance = operations
        .maintenance(Duration::from_secs(1))
        .await
        .unwrap();
    assert_eq!(
        manager
            .create("game".into(), "room".into(), None, "host".into())
            .unwrap_err()
            .code,
        "app:maintenance_in_progress"
    );
    assert_eq!(
        manager.discover("game").unwrap_err().code,
        "app:maintenance_in_progress"
    );
    drop(maintenance);
    assert_ne!(create(&manager).room_id, first.room_id);
    manager.shutdown();
    manager.shutdown();
    assert!(operations.wait_idle(Duration::ZERO));
    assert_eq!(
        manager
            .create("game".into(), "room".into(), None, "host".into())
            .unwrap_err()
            .code,
        "app:shutting_down"
    );
    assert_eq!(
        manager
            .send(
                manager.status().instance_id.as_deref().unwrap_or("stale"),
                "message".into()
            )
            .unwrap_err()
            .code,
        "app:shutting_down"
    );
}

#[test]
fn fragmented_handshake_and_idle_connection_are_joined_without_waiting_for_timeout() {
    let _network = super::tests::network_guard();
    let operations = Arc::new(Operations::default());
    let manager = manager(operations.clone());
    let port = create(&manager).port.unwrap();
    let mut idle = connect(port);
    idle.write_all(b"{\"type\":").unwrap();
    let mut guest = connect(port);
    guest
        .write_all(b"{\"type\":\"hello\",\"gameId\":\"gom")
        .unwrap();
    thread::sleep(Duration::from_millis(40));
    guest
        .write_all(b"oku\",\"code\":null,\"playerName\":\"guest\"}\n")
        .unwrap();
    let mut welcome = String::new();
    BufReader::new(&guest).read_line(&mut welcome).unwrap();
    assert!(matches!(
        serde_json::from_str::<WireMsg>(&welcome).unwrap(),
        WireMsg::Welcome { .. }
    ));
    wait_for(|| manager.status().peer_name.is_some());
    let started = Instant::now();
    manager.leave();
    assert!(started.elapsed() < Duration::from_secs(2));
    assert!(matches!(idle.read(&mut [0]), Ok(0) | Err(_)));
    assert_eq!(manager.status().phase, "idle");
    assert!(operations.wait_idle(Duration::ZERO));
}

#[test]
fn leave_wakes_backpressured_send_without_taking_the_writer_mutex() {
    let _network = super::tests::network_guard();
    let operations = Arc::new(Operations::default());
    let manager = manager(operations.clone());
    let mut guest = connect(create(&manager).port.unwrap());
    handshake(&mut guest);
    wait_for(|| manager.status().peer_name.is_some());
    let (done, result) = mpsc::channel();
    let sender = manager.clone();
    let worker = thread::spawn(move || {
        // Fill the socket with individually valid frames until the peer's
        // receive window closes; oversized frames are now rejected before IO.
        let result = (0..128).try_for_each(|_| {
            sender.send(
                sender.status().instance_id.as_deref().unwrap_or("stale"),
                "x".repeat(128 * 1024),
            )
        });
        done.send(result).unwrap();
    });
    assert!(result.recv_timeout(Duration::from_millis(150)).is_err());
    let started = Instant::now();
    manager.leave();
    assert!(result
        .recv_timeout(Duration::from_secs(2))
        .unwrap()
        .is_err());
    worker.join().unwrap();
    assert!(started.elapsed() < Duration::from_secs(2));
    assert!(operations.wait_idle(Duration::ZERO));
}

struct NoLog;
impl ActivitySink for NoLog {
    fn record(&self, _: &OperationContext, _: Option<&AppError>) -> AppResult<()> {
        Ok(())
    }
}

#[tokio::test]
async fn canceled_leave_waiter_retains_generation_and_admission_until_callback_finishes() {
    let _network = super::tests::network_guard();
    let operations = Arc::new(Operations::default());
    let executor = Executor::new(Arc::new(NoLog), operations.clone());
    let (started, ready) = tokio::sync::oneshot::channel();
    let started = Mutex::new(Some(started));
    let (release, finish) = mpsc::channel();
    let finish = Mutex::new(finish);
    let manager = Arc::new(GameRoomManager::new(
        Arc::new(move |_, event| {
            if matches!(event, RoomEvent::Message { .. }) {
                started.lock().take().unwrap().send(()).unwrap();
                finish.lock().recv_timeout(Duration::from_secs(3)).unwrap();
            }
        }),
        operations.clone(),
    ));
    let mut guest = connect(create(&manager).port.unwrap());
    handshake(&mut guest);
    guest
        .write_all(b"{\"type\":\"app\",\"payload\":\"move\"}\n")
        .unwrap();
    ready.await.unwrap();
    let stop = manager.clone();
    let mut leave = Box::pin(executor.blocking_unlogged(move || {
        stop.leave();
        Ok(())
    }));
    assert!(futures_util::poll!(&mut leave).is_pending());
    drop(leave);
    let mut maintenance = Box::pin(executor.maintenance());
    assert!(futures_util::poll!(&mut maintenance).is_pending());
    assert_eq!(manager.status().phase, "hosting");
    assert!(!operations.wait_idle(Duration::ZERO));
    release.send(()).unwrap();
    let lease = tokio::time::timeout(Duration::from_secs(3), maintenance)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(manager.status().phase, "idle");
    drop(lease);
}

#[test]
fn queued_creation_rechecks_permanent_shutdown_after_lifecycle_lock() {
    let operations = Arc::new(Operations::default());
    let manager = manager(operations.clone());
    let gate = manager.lifecycle.lock();
    let pending = manager.clone();
    let start =
        thread::spawn(move || pending.create("game".into(), "room".into(), None, "host".into()));
    wait_for(|| !manager.in_flight.wait_idle(Duration::ZERO));
    let closing = manager.clone();
    let shutdown = thread::spawn(move || closing.shutdown());
    wait_for(|| manager.in_flight.is_closed());
    drop(gate);
    assert_eq!(start.join().unwrap().unwrap_err().code, "app:shutting_down");
    shutdown.join().unwrap();
    assert!(operations.wait_idle(Duration::ZERO));
}

#[test]
fn partial_start_rolls_back_workers_before_releasing_admission() {
    let operations = Arc::new(Operations::default());
    let (ended, finished) = mpsc::channel();
    let result: AppResult<()> = (|| {
        let mut handle = RoomHandle::new(operations.begin()?);
        let stop = handle.stop.clone();
        handle.spawn("room-partial", move || {
            stop.wait(Duration::from_secs(10));
            ended.send(()).unwrap();
        })?;
        Err(std::io::Error::other("later installation failed").into())
    })();
    assert!(result.is_err());
    finished.recv_timeout(Duration::from_secs(1)).unwrap();
    assert!(operations.wait_idle(Duration::ZERO));
}

#[test]
fn discovery_probe_stops_even_when_peer_keeps_dripping_bytes() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address: SocketAddr = listener.local_addr().unwrap();
    let (started, ready) = mpsc::channel();
    let server = thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        socket
            .set_write_timeout(Some(Duration::from_secs(1)))
            .unwrap();
        started.send(()).unwrap();
        for _ in 0..50 {
            if socket.write_all(b" ").is_err() {
                return;
            }
            thread::sleep(Duration::from_millis(20));
        }
    });
    let stop = Arc::new(StopSignal::default());
    let worker_stop = stop.clone();
    let probe = thread::spawn(move || discovery::probe_room_until_stop(address, &worker_stop));
    ready.recv_timeout(Duration::from_secs(1)).unwrap();
    stop.stop();
    let started = Instant::now();
    assert!(probe.join().unwrap().is_none());
    assert!(started.elapsed() < Duration::from_secs(1));
    server.join().unwrap();
}

#[test]
fn shutdown_cancels_and_joins_an_admitted_discovery_sweep() {
    let _network = super::tests::network_guard();
    let operations = Arc::new(Operations::default());
    let manager = manager(operations.clone());
    let searching = manager.clone();
    let search = thread::spawn(move || searching.discover("shutdown-test"));
    wait_for(|| !manager.in_flight.wait_idle(Duration::ZERO));
    manager.shutdown();
    assert_eq!(
        search.join().unwrap().unwrap_err().code,
        "app:shutting_down"
    );
    assert!(operations.wait_idle(Duration::ZERO));
}

#[test]
fn panicked_peer_reader_releases_the_seat_and_can_be_joined_again() {
    let _network = super::tests::network_guard();
    let operations = Arc::new(Operations::default());
    let (events, received) = mpsc::channel();
    let manager = GameRoomManager::new(
        Arc::new(move |_, event| {
            if matches!(event, RoomEvent::Message { .. }) {
                panic!("simulated reader callback failure");
            }
            events.send(event).unwrap();
        }),
        operations.clone(),
    );
    let port = create(&manager).port.unwrap();
    let mut first = connect(port);
    handshake(&mut first);
    first
        .write_all(b"{\"type\":\"app\",\"payload\":\"move\"}\n")
        .unwrap();
    loop {
        if matches!(
            received.recv_timeout(Duration::from_secs(2)).unwrap(),
            RoomEvent::PeerLeft
        ) {
            break;
        }
    }
    let mut second = connect(port);
    handshake(&mut second);
    manager.leave();
    assert!(operations.wait_idle(Duration::ZERO));
}

#[test]
fn discovery_probe_bounds_total_time_and_response_size_without_a_stop_request() {
    for oversized in [false, true] {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_write_timeout(Some(Duration::from_secs(1)))
                .unwrap();
            if oversized {
                let _ = socket.write_all(&[b' '; 20 * 1024]);
                let _ = socket.write_all(b"\n");
            } else {
                for _ in 0..100 {
                    if socket.write_all(b" ").is_err() {
                        break;
                    }
                    thread::sleep(Duration::from_millis(20));
                }
            }
        });
        let started = Instant::now();
        assert!(discovery::probe_room(address).is_none());
        assert!(started.elapsed() < Duration::from_secs(1));
        server.join().unwrap();
    }
}
