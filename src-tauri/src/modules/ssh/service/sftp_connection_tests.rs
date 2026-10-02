use super::super::test_support::{material, Fixture};
use super::*;

#[test]
fn disconnected_or_replaced_auth_cannot_publish_a_connection() {
    for replace in [false, true] {
        let fixture = Fixture::new();
        let manager = &fixture.manager;
        manager.register("session", material());
        let original = manager.material("session").unwrap();
        let slot = Arc::new(SftpSlot::default());
        manager.sftp.lock().insert("session".into(), slot.clone());
        manager.disconnect("session");
        if replace {
            manager.register("session", material());
        }
        let mut published = false;
        let error = manager
            .with_current_slot("session", &original, &slot, || published = true)
            .unwrap_err();
        assert_eq!(error.code, "ssh:session_not_found");
        assert!(!published);
        assert!(manager.sftp.lock().is_empty());
    }
}

#[test]
fn reset_detaches_initializing_slot_without_blocking_or_invalidating_its_successor() {
    let fixture = Fixture::new();
    let manager = &fixture.manager;
    manager.register("session", material());
    let auth = manager.material("session").unwrap();
    let old = Arc::new(SftpSlot::default());
    manager.sftp.lock().insert("session".into(), old.clone());
    let _initializing = old.connection.lock();
    manager.reset_sftp_conn("session");
    let new = Arc::new(SftpSlot::default());
    manager.sftp.lock().insert("session".into(), new.clone());
    assert!(manager
        .with_current_slot("session", &auth, &old, || ())
        .is_err());
    let mut published = false;
    manager
        .with_current_slot("session", &auth, &new, || published = true)
        .unwrap();
    assert!(published);
    assert!(Arc::ptr_eq(
        manager.sftp.lock().get("session").unwrap(),
        &new
    ));
}

#[test]
fn disconnect_does_not_wait_for_an_unrelated_connection_initialization() {
    let fixture = Fixture::new();
    fixture.manager.register("first", material());
    fixture.manager.register("second", material());
    let slot = Arc::new(SftpSlot::default());
    fixture
        .manager
        .sftp
        .lock()
        .insert("first".into(), slot.clone());
    let _initializing = slot.connection.lock();
    fixture.manager.disconnect("second");
    assert!(fixture.manager.material("first").is_ok());
    assert!(fixture.manager.material("second").is_err());
}
