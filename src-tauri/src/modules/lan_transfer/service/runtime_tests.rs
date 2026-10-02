use super::{LanServerHandle, LanServerRuntime};
use crate::modules::lan_transfer::service::tests::Fixture;
use parking_lot::Mutex;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::{Duration, Instant};

#[test]
fn stopping_generation_remains_visible_and_blocks_restart_until_worker_finishes() {
    let fixture = Fixture::new();
    let stop = Arc::new(AtomicBool::new(false));
    let (release, finish) = mpsc::channel();
    let worker = thread::spawn(move || finish.recv_timeout(Duration::from_secs(4)).unwrap());
    *fixture.manager.runtime.lock() = Some(LanServerRuntime {
        host: "127.0.0.1".into(),
        port: 12345,
        bind_host: "127.0.0.1".into(),
        security_mode: "open".into(),
        confirmation_code: None,
        authorized_tokens: Arc::new(Mutex::new(HashMap::new())),
        blocked_sessions: Arc::new(Mutex::new(HashSet::new())),
        pending_auth: Arc::new(Mutex::new(HashMap::new())),
        devices: Arc::new(Mutex::new(HashMap::new())),
        tasks: Arc::default(),
        handle: Some(LanServerHandle {
            stop: stop.clone(),
            join: Some(worker),
            discovery_join: None,
            _lease: fixture.operations.begin().unwrap(),
        }),
    });
    let manager = fixture.manager.clone();
    let (stopped, completion) = mpsc::channel();
    let stopper = thread::spawn(move || {
        manager.stop();
        stopped.send(()).unwrap();
    });
    let deadline = Instant::now() + Duration::from_secs(2);
    while !stop.load(Ordering::SeqCst) {
        assert!(Instant::now() < deadline);
        thread::yield_now();
    }
    assert!(fixture.manager.status().running);
    assert!(!fixture.operations.wait_idle(Duration::from_millis(20)));
    assert!(completion.try_recv().is_err());
    let manager = fixture.manager.clone();
    let settings = fixture.settings();
    let db = fixture.root.join("test.db");
    let (started, result) = mpsc::channel();
    let starter = thread::spawn(move || {
        started
            .send(manager.start(settings, vec![], vec![], db))
            .unwrap();
    });
    assert!(result.recv_timeout(Duration::from_millis(50)).is_err());
    release.send(()).unwrap();
    completion.recv_timeout(Duration::from_secs(2)).unwrap();
    let status = result
        .recv_timeout(Duration::from_secs(2))
        .unwrap()
        .unwrap();
    assert!(status.running);
    stopper.join().unwrap();
    starter.join().unwrap();
    fixture.manager.stop();
    assert!(!fixture.manager.status().running);
    assert!(fixture.operations.wait_idle(Duration::from_millis(50)));
}

#[test]
fn partial_installation_drop_keeps_lease_until_started_worker_has_exited() {
    let fixture = Fixture::new();
    let stop = Arc::new(AtomicBool::new(false));
    let worker_stop = stop.clone();
    let (stopping, stopped) = mpsc::channel();
    let (release, finish) = mpsc::channel();
    let worker = thread::spawn(move || {
        while !worker_stop.load(Ordering::SeqCst) {
            thread::yield_now();
        }
        stopping.send(()).unwrap();
        finish.recv_timeout(Duration::from_secs(3)).unwrap();
    });
    // A discovery-thread spawn failure drops this partially populated owner.
    let handle = LanServerHandle {
        stop,
        join: Some(worker),
        discovery_join: None,
        _lease: fixture.operations.begin().unwrap(),
    };
    let rollback = thread::spawn(move || drop(handle));
    stopped.recv_timeout(Duration::from_secs(2)).unwrap();
    assert!(!fixture.operations.wait_idle(Duration::from_millis(20)));
    release.send(()).unwrap();
    rollback.join().unwrap();
    assert!(fixture.operations.wait_idle(Duration::from_millis(50)));
}
