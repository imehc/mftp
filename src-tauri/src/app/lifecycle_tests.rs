use super::*;
use std::sync::atomic::{AtomicBool, AtomicUsize};

#[test]
fn shutdown_is_once_and_closes_pipeline_admission() {
    let operations = Arc::new(Operations::default());
    let mut lifecycle = Lifecycle::new(operations.clone());
    let calls = Arc::new(AtomicUsize::new(0));
    lifecycle.install(
        "test",
        calls.clone(),
        |calls| {
            calls.fetch_add(1, Ordering::SeqCst);
        },
        |_| Ok(false),
    );
    assert!(lifecycle.begin_shutdown());
    assert!(!lifecycle.begin_shutdown());
    assert!(operations.begin().is_err());
    assert!(lifecycle
        .shutdown_blocking(Duration::from_secs(1))
        .completed());
    assert!(!lifecycle.is_finished());
    lifecycle.finish_shutdown();
    assert!(lifecycle.is_finished());
    drop(lifecycle);
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[test]
fn installation_failure_rolls_back_in_reverse_order() {
    struct Service(usize, Arc<Mutex<Vec<usize>>>);
    let stopped = Arc::new(Mutex::new(Vec::new()));
    let mut lifecycle = Lifecycle::new(Arc::new(Operations::default()));
    for id in [1, 2, 3] {
        lifecycle.install(
            "test",
            Arc::new(Service(id, stopped.clone())),
            |service| {
                service.1.lock().push(service.0);
            },
            |_| Ok(false),
        );
    }
    drop(lifecycle);
    assert_eq!(*stopped.lock(), [3, 2, 1]);
}

#[test]
fn stalled_participant_does_not_block_other_stop_requests() {
    struct Blocked(Mutex<mpsc::Receiver<()>>);
    let (release, wait) = mpsc::channel();
    let (finished, completion) = mpsc::channel();
    let mut lifecycle = Lifecycle::new(Arc::new(Operations::default()));
    lifecycle.install(
        "blocked",
        Arc::new(Blocked(Mutex::new(wait))),
        |blocked| {
            let _ = blocked.0.lock().recv();
        },
        |_| Ok(false),
    );
    lifecycle.install(
        "ready",
        Arc::new(finished),
        |finished| {
            let _ = finished.send(());
        },
        |_| Ok(false),
    );
    lifecycle.begin_shutdown();
    let report = lifecycle.shutdown_blocking(Duration::from_millis(200));
    assert_eq!(report.unfinished, ["blocked"]);
    completion.recv_timeout(Duration::from_secs(1)).unwrap();
    release.send(()).unwrap();
    assert!(!report.completed());
}

#[test]
fn rollback_continues_after_a_stop_callback_panics() {
    struct Service(usize, Arc<Mutex<Vec<usize>>>);
    let stopped = Arc::new(Mutex::new(Vec::new()));
    let mut lifecycle = Lifecycle::new(Arc::new(Operations::default()));
    for id in [1, 2, 3] {
        lifecycle.install(
            "test",
            Arc::new(Service(id, stopped.clone())),
            |service| {
                service.1.lock().push(service.0);
                if service.0 == 2 {
                    panic!("stop failed during rollback");
                }
            },
            |_| Ok(false),
        );
    }
    // Exercise Drop during setup unwinding, where a second panic would abort.
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
        let _installed = lifecycle;
        panic!("setup failed");
    }));
    assert!(result.is_err());
    assert_eq!(*stopped.lock(), [3, 2, 1]);
}

#[test]
fn returned_stop_callbacks_do_not_hide_an_active_pipeline_worker() {
    let operations = Arc::new(Operations::default());
    let lease = operations.begin().unwrap();
    let lifecycle = Lifecycle::new(operations.clone());
    assert!(lifecycle.begin_shutdown());
    let report = lifecycle.shutdown_blocking(Duration::ZERO);
    assert!(report.unfinished.is_empty());
    assert!(!report.operations_idle);
    assert!(!report.completed());
    drop(lease);
    assert!(operations.wait_idle(Duration::ZERO));
    assert!(operations.begin().is_err());
}

#[tokio::test]
async fn shutdown_tracks_maintenance_and_never_reopens_when_it_finishes() {
    let operations = Arc::new(Operations::default());
    let maintenance = operations
        .maintenance(Duration::from_secs(1))
        .await
        .unwrap();
    let lifecycle = Lifecycle::new(operations.clone());
    assert!(lifecycle.begin_shutdown());
    let report = lifecycle.shutdown_blocking(Duration::ZERO);
    assert!(!report.operations_idle);
    assert!(!report.completed());
    drop(maintenance);
    assert!(operations.wait_idle(Duration::ZERO));
    assert_eq!(
        lifecycle.check_admission().unwrap_err().code,
        "app:shutting_down"
    );
    assert_eq!(operations.begin().err().unwrap().code, "app:shutting_down");
}

#[test]
fn ssh_shutdown_reports_live_domain_work_as_unfinished() {
    use crate::modules::ssh::Manager;
    let root = std::env::temp_dir().join(format!("ssh-shutdown-{}", uuid::Uuid::new_v4()));
    let manager = Arc::new(Manager::new(root.join("journal.json")));
    let mut lifecycle = Lifecycle::new(Arc::new(Operations::default()));
    lifecycle.install(
        "ssh",
        manager.clone(),
        Manager::shutdown_all,
        |manager: &Manager| Ok(manager.is_busy()),
    );
    let lease = manager.operation().unwrap();
    lifecycle.begin_shutdown();
    let report = lifecycle.shutdown_blocking(Duration::from_millis(20));
    assert_eq!(report.unfinished, vec!["ssh"]);
    drop(lease);
    // Idempotent stop waits on the same real work and leaves admission closed.
    manager.shutdown_all();
    assert_eq!(manager.operation().err().unwrap().code, "app:shutting_down");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn maintenance_and_exit_share_one_participant_registry() {
    use crate::error::AppErrorKind;

    struct Service(AtomicBool);
    let mut lifecycle = Lifecycle::new(Arc::new(Operations::default()));
    let alpha = lifecycle.install(
        "alpha",
        Arc::new(Service(AtomicBool::new(true))),
        |_service| {},
        |service: &Service| Ok(service.0.load(Ordering::SeqCst)),
    );
    lifecycle.install(
        "beta",
        Arc::new(Service(AtomicBool::new(false))),
        |_service| {},
        |service: &Service| Ok(service.0.load(Ordering::SeqCst)),
    );
    assert_eq!(lifecycle.participant_ids(), ["alpha", "beta"]);
    let busy = lifecycle.ensure_no_busy(&["alpha", "beta"]).unwrap_err();
    assert_eq!(busy.kind, AppErrorKind::Custom);
    assert_eq!(busy.code, "app:data_busy");
    assert_eq!(
        busy.args.get("participant").map(String::as_str),
        Some("alpha")
    );
    alpha.0.store(false, Ordering::SeqCst);
    assert!(lifecycle.ensure_no_busy(&["alpha", "beta"]).is_ok());
    assert!(lifecycle.ensure_no_busy(&[]).is_ok());
    // Fail-closed: an unregistered requested participant is a busy rejection,
    // never a silently skipped maintenance check.
    let missing = lifecycle.ensure_no_busy(&["gamma"]).unwrap_err();
    assert_eq!(
        missing.args.get("participant").map(String::as_str),
        Some("gamma")
    );
}
