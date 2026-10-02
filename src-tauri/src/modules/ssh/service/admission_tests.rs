use super::super::test_support::{material, Fixture};
use super::*;
use crate::core::execution::{run_blocking, run_blocking_guarded};
use futures_util::poll;
use std::{fs, sync::mpsc};

#[tokio::test]
async fn cancelled_command_waiter_does_not_release_worker_or_its_temp_file() {
    let fixture = Fixture::new();
    let manager = fixture.manager.clone();
    let path = fixture.root.join("active.part");
    let worker_path = path.clone();
    let (started, ready) = tokio::sync::oneshot::channel();
    let (release, wait) = mpsc::channel();
    let lease = manager.operation().unwrap();
    let command = tokio::spawn(run_blocking_guarded(lease, move || {
        let _temp = manager.track_local_temp(worker_path.clone())?;
        fs::write(worker_path, b"partial")?;
        started.send(()).unwrap();
        wait.recv_timeout(Duration::from_secs(5)).unwrap();
        Ok(())
    }));
    ready.await.unwrap();
    command.abort();
    assert!(command.await.is_err());
    let mut maintenance = Box::pin(fixture.manager.maintenance());
    assert!(poll!(&mut maintenance).is_pending());
    assert_eq!(
        fixture.manager.operation().err().unwrap().code,
        "app:maintenance_in_progress"
    );
    assert!(path.exists());
    assert!(fixture.root.join("journal.json").exists());
    release.send(()).unwrap();
    let maintenance = maintenance.await.unwrap();
    assert!(!path.exists());
    assert!(!fixture.root.join("journal.json").exists());
    drop(maintenance);
    assert!(fixture.manager.operation().is_ok());
}

#[test]
fn shutdown_waits_for_real_cleanup_and_cancels_even_unlabelled_transfers() {
    let fixture = Fixture::new();
    let manager = fixture.manager.clone();
    let path = fixture.root.join("active.part");
    let lease = manager.operation().unwrap();
    let temp = manager.track_local_temp(path.clone()).unwrap();
    fs::write(&path, b"active").unwrap();
    let transfer = manager.transfer_guard(None).unwrap();
    let stopper = manager.clone();
    let (finished, done) = mpsc::channel();
    let thread = std::thread::spawn(move || {
        stopper.shutdown_all();
        finished.send(()).unwrap();
    });
    assert_eq!(
        transfer
            .wait_retry(Duration::from_secs(5))
            .unwrap_err()
            .code,
        "sftp:transfer_cancelled"
    );
    assert_eq!(manager.operation().err().unwrap().code, "app:shutting_down");
    assert!(done.try_recv().is_err());
    assert_eq!(fs::read(&path).unwrap(), b"active");
    // Already-admitted commands may only register their transfer after stop.
    let late = manager.transfer_guard(Some("late")).unwrap();
    assert!(late.check().is_err());
    drop(late);
    drop(transfer);
    drop(temp);
    drop(lease);
    done.recv_timeout(Duration::from_secs(2)).unwrap();
    thread.join().unwrap();
    assert!(!path.exists());
    assert!(manager.transfers.lock().is_empty());
    assert!(!manager.is_busy());
}

#[tokio::test]
async fn deletion_retains_ssh_exclusion_after_its_waiter_is_dropped() {
    let fixture = Fixture::new();
    let maintenance = fixture.manager.maintenance().await.unwrap();
    let (started, ready) = tokio::sync::oneshot::channel();
    let (release, wait) = mpsc::channel();
    let deletion = tokio::spawn(run_blocking(move || {
        let _maintenance = maintenance;
        started.send(()).unwrap();
        wait.recv_timeout(Duration::from_secs(5)).unwrap();
        Ok(())
    }));
    ready.await.unwrap();
    deletion.abort();
    assert!(deletion.await.is_err());
    assert_eq!(
        fixture.manager.operation().err().unwrap().code,
        "app:maintenance_in_progress"
    );
    release.send(()).unwrap();
    assert!(fixture.manager.operations.wait_idle(Duration::from_secs(2)));
    assert!(fixture.manager.operation().is_ok());
}

#[tokio::test]
async fn maintenance_does_not_cancel_an_already_admitted_transfer() {
    let fixture = Fixture::new();
    let lease = fixture.manager.operation().unwrap();
    let mut maintenance = Box::pin(fixture.manager.maintenance());
    assert!(poll!(&mut maintenance).is_pending());
    let transfer = fixture.manager.transfer_guard(Some("late")).unwrap();
    assert!(transfer.check().is_ok());
    drop(transfer);
    drop(lease);
    drop(maintenance.await.unwrap());
}

#[tokio::test]
async fn idle_check_is_made_under_exclusion_and_cancel_tombstones_are_not_work() {
    let fixture = Fixture::new();
    fixture.manager.cancel_transfer("never-started");
    assert!(!fixture.manager.is_busy());
    fixture.manager.register("session", material());
    let maintenance = fixture.manager.maintenance().await.unwrap();
    assert!(fixture.manager.is_busy());
    assert!(fixture.manager.operation().is_err());
    drop(maintenance);
    fixture.manager.disconnect("session");
    assert!(!fixture.manager.is_busy());
}

#[tokio::test]
async fn maintenance_drains_shell_worker_leases_and_blocks_new_reservations() {
    let fixture = Fixture::new();
    let manager = fixture.manager.clone();
    // A started shell holds its workers lease after the open command returned;
    // resetting while it is still alive must be rejected, not silently drained.
    let stalled = manager.workers.begin().unwrap();
    let mut maintenance = Box::pin(manager.maintenance());
    assert!(poll!(&mut maintenance).is_pending());
    assert_eq!(
        manager.workers.begin().err().unwrap().code,
        "app:maintenance_in_progress"
    );
    drop(maintenance);
    assert!(manager.workers.begin().is_ok());
    let Err(error) = manager.workers.maintenance(Duration::from_millis(50)).await else {
        panic!("a stalled shell worker lease must block the maintenance drain");
    };
    assert_eq!(error.code, "app:operations_busy");
    drop(stalled);
    let maintenance = manager.maintenance().await.unwrap();
    assert_eq!(
        manager.workers.begin().err().unwrap().code,
        "app:maintenance_in_progress"
    );
    drop(maintenance);
    assert!(manager.workers.begin().is_ok());
}
