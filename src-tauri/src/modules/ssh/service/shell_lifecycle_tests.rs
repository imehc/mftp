use super::super::test_support::{material, Fixture};
use super::*;
use std::{sync::mpsc, time::Duration};

fn reserve(fixture: &Fixture) -> (Arc<ShellHandle>, ShellCompletion) {
    let (tx, _rx) = mpsc::channel();
    let handle = Arc::new(ShellHandle::new(tx));
    fixture
        .manager
        .shells
        .lock()
        .insert("session".into(), handle.clone());
    let completion = ShellCompletion {
        shells: fixture.manager.shells.clone(),
        id: "session".into(),
        handle: handle.clone(),
        _lease: fixture.manager.workers.begin().unwrap(),
    };
    (handle, completion)
}

#[test]
fn natural_completion_and_setup_failure_release_reservation() {
    let fixture = Fixture::new();
    let (handle, completion) = reserve(&fixture);
    handle.started();
    assert!(handle.wait_started().is_ok());
    assert!(!fixture.manager.workers.wait_idle(Duration::ZERO));
    drop(completion);
    handle.wait();
    assert!(fixture.manager.shells.lock().is_empty());
    assert!(fixture.manager.workers.wait_idle(Duration::ZERO));
    let (handle, completion) = reserve(&fixture);
    drop(completion);
    assert_eq!(handle.wait_started().unwrap_err().code, "ssh:shell_closed");
}

#[test]
fn stale_completion_cannot_remove_a_new_shell() {
    let fixture = Fixture::new();
    let (_, old) = reserve(&fixture);
    let (current, new) = reserve(&fixture);
    drop(old);
    assert!(Arc::ptr_eq(
        fixture.manager.shells.lock().get("session").unwrap(),
        &current
    ));
    assert!(!fixture.manager.workers.wait_idle(Duration::ZERO));
    drop(new);
    assert!(fixture.manager.workers.wait_idle(Duration::ZERO));
}

#[test]
fn disconnect_waits_for_worker_completion_without_holding_session_maps() {
    let fixture = Fixture::new();
    fixture.manager.register("session", material());
    let (handle, completion) = reserve(&fixture);
    let manager = fixture.manager.clone();
    let (finished, done) = mpsc::channel();
    let disconnect = std::thread::spawn(move || {
        manager.disconnect("session");
        finished.send(()).unwrap();
    });
    // Waiting for the close state establishes that disconnect invalidated auth.
    assert!(handle.wait_started().is_err());
    assert!(done.try_recv().is_err());
    assert!(fixture.manager.auth.lock().is_empty());
    fixture.manager.register("unrelated", material());
    drop(completion);
    done.recv_timeout(Duration::from_secs(2)).unwrap();
    disconnect.join().unwrap();
}

#[test]
fn completion_barrier_survives_unwinding_after_resources_drop() {
    let fixture = Fixture::new();
    let (_, completion) = reserve(&fixture);
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _completion = completion;
        panic!("fake worker failure");
    }));
    assert!(result.is_err());
    assert!(fixture.manager.shells.lock().is_empty());
    assert!(fixture.manager.workers.wait_idle(Duration::ZERO));
}
