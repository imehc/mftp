use super::super::test_support::{material, Fixture};
use super::*;

#[test]
fn remote_command_control_observes_disconnect_generation_and_shutdown() {
    let fixture = Fixture::new();
    let manager = &fixture.manager;
    manager.register("session", material());
    let original = manager.material("session").unwrap();
    assert!(!manager.command_control("session", &original, None).unwrap());
    manager.register("session", material());
    assert_eq!(
        manager
            .command_control("session", &original, None)
            .unwrap_err()
            .code,
        "ssh:session_not_found"
    );
    manager.operations.close();
    // Fails before any DNS/network call or mutation of the shared cache.
    assert_eq!(
        manager.exec("session", "unused").unwrap_err().code,
        "app:shutting_down"
    );
    assert!(manager.sftp.lock().is_empty());
}

#[test]
fn remote_command_control_keeps_transfer_pause_and_cancellation() {
    let fixture = Fixture::new();
    let manager = &fixture.manager;
    manager.register("session", material());
    let material = manager.material("session").unwrap();
    let transfer = manager.transfer_guard(Some("task")).unwrap();
    manager.pause_transfer("task").unwrap();
    assert!(manager
        .command_control("session", &material, Some(&transfer))
        .unwrap());
    manager.cancel_transfer("task");
    assert_eq!(
        manager
            .command_control("session", &material, Some(&transfer))
            .unwrap_err(),
        AppError::custom(CustomErrorCode::SftpTransferCancelled)
    );
}
