use super::access::{Authorization, Caller, ModuleGrant, Permission, ALL_MODULES};
use std::{
    collections::BTreeMap,
    sync::{mpsc, Arc},
    time::Duration,
};

#[test]
fn global_permission_applies_to_current_and_future_modules_without_implying_delete() {
    let caller = Caller::new(
        "global-client".into(),
        BTreeMap::from([(
            ALL_MODULES.into(),
            ModuleGrant {
                read: true,
                write: true,
                delete: false,
            },
        )]),
    );
    for module in ["todo", "future_module"] {
        assert!(caller.allows(module, Permission::Read));
        assert!(caller.allows(module, Permission::Write));
        assert!(!caller.allows(module, Permission::Delete));
    }
}

#[test]
fn legacy_module_permissions_are_not_silently_widened() {
    let caller = Caller::new(
        "legacy-client".into(),
        BTreeMap::from([(
            "todo".into(),
            ModuleGrant {
                read: true,
                write: false,
                delete: false,
            },
        )]),
    );
    assert!(caller.allows("todo", Permission::Read));
    assert!(!caller.allows("future_module", Permission::Read));
}

#[test]
fn revocation_linearizes_before_new_workers_and_waits_for_admitted_workers() {
    let authorization = Arc::new(Authorization::default());
    let caller = Caller::authenticated(
        "one".into(),
        BTreeMap::from([(
            "test".into(),
            ModuleGrant {
                read: true,
                write: true,
                delete: false,
            },
        )]),
        authorization.clone(),
    );
    let (started_tx, started_rx) = mpsc::channel();
    let (finish_tx, finish_rx) = mpsc::channel();
    let worker = caller.clone();
    let task = std::thread::spawn(move || {
        worker.execute(|| {
            started_tx.send(()).unwrap();
            finish_rx.recv().unwrap();
            Ok(())
        })
    });
    started_rx.recv_timeout(Duration::from_secs(2)).unwrap();
    authorization.disable();
    assert!(!caller.allows("test", Permission::Write));
    assert_eq!(
        caller.execute(|| Ok(())).unwrap_err().code,
        "mcp:unauthorized"
    );
    let (drained_tx, drained_rx) = mpsc::channel();
    let drain = std::thread::spawn(move || {
        authorization.drain();
        drained_tx.send(()).unwrap();
    });
    assert!(drained_rx.recv_timeout(Duration::from_millis(50)).is_err());
    finish_tx.send(()).unwrap();
    task.join().unwrap().unwrap();
    drained_rx.recv_timeout(Duration::from_secs(2)).unwrap();
    drain.join().unwrap();
}
