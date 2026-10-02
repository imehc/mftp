use super::*;
use std::sync::mpsc;
use std::time::Duration;

fn manager() -> (GameRoomManager, mpsc::Receiver<(String, RoomEvent)>) {
    let (sender, events) = mpsc::channel();
    let manager = GameRoomManager::new(
        Arc::new(move |id, event| {
            sender.send((id.to_owned(), event)).unwrap();
        }),
        Arc::new(Operations::default()),
    );
    (manager, events)
}

fn create(manager: &GameRoomManager) -> GameRoomStatus {
    manager
        .create("gomoku".into(), "room".into(), None, "host".into())
        .unwrap()
}

fn join(manager: &GameRoomManager, port: u16) -> GameRoomStatus {
    manager
        .join(
            "127.0.0.1".into(),
            port,
            "gomoku".into(),
            None,
            "guest".into(),
        )
        .unwrap()
}

#[tokio::test]
async fn stale_leave_cannot_close_a_replacement_and_current_leave_releases_its_lease() {
    let _network = tests::network_guard();
    let (manager, _events) = manager();
    let first = create(&manager).instance_id.unwrap();
    let second = create(&manager).instance_id.unwrap();
    assert_ne!(first, second);
    manager.leave_instance(&first);
    assert_eq!(
        manager.status().instance_id.as_deref(),
        Some(second.as_str())
    );
    assert!(manager
        .operations
        .maintenance(Duration::from_millis(10))
        .await
        .is_err());
    manager.leave_instance(&second);
    assert!(manager.status().instance_id.is_none());
    assert!(manager
        .operations
        .maintenance(Duration::from_millis(10))
        .await
        .is_ok());
    manager.leave_instance(&second);
}

#[test]
fn rejoining_the_same_remote_room_changes_local_identity_and_isolates_events_and_sends() {
    let _network = tests::network_guard();
    let (host, host_events) = manager();
    let hosted = create(&host);
    let host_id = hosted.instance_id.unwrap();
    let (guest, guest_events) = manager();
    let first = join(&guest, hosted.port.unwrap());
    assert!(
        matches!(host_events.recv_timeout(Duration::from_secs(2)).unwrap(), (id, RoomEvent::PeerJoined { .. }) if id == host_id)
    );
    guest.leave_instance(first.instance_id.as_deref().unwrap());
    assert!(
        matches!(host_events.recv_timeout(Duration::from_secs(2)).unwrap(), (id, RoomEvent::PeerLeft) if id == host_id)
    );
    let second = join(&guest, hosted.port.unwrap());
    assert_eq!(first.room_id, second.room_id);
    assert_ne!(first.instance_id, second.instance_id);
    let guest_id = second.instance_id.unwrap();
    let error = guest
        .send(first.instance_id.as_deref().unwrap(), "stale".into())
        .unwrap_err();
    assert_eq!(error.code, "room:not_joined");
    guest.leave_instance(first.instance_id.as_deref().unwrap());
    guest.send(&guest_id, "current".into()).unwrap();
    assert!(
        matches!(host_events.recv_timeout(Duration::from_secs(2)).unwrap(), (id, RoomEvent::PeerJoined { .. }) if id == host_id)
    );
    assert!(
        matches!(host_events.recv_timeout(Duration::from_secs(2)).unwrap(), (id, RoomEvent::Message { payload }) if id == host_id && payload == "current")
    );
    host.send(&host_id, "reply".into()).unwrap();
    assert!(
        matches!(guest_events.recv_timeout(Duration::from_secs(2)).unwrap(), (id, RoomEvent::Message { payload }) if id == guest_id && payload == "reply")
    );
    host.leave_instance(&host_id);
    assert!(
        matches!(guest_events.recv_timeout(Duration::from_secs(2)).unwrap(), (id, RoomEvent::Closed { .. }) if id == guest_id)
    );
    guest.leave_instance(&guest_id);
}

#[test]
fn delayed_publication_keeps_the_identity_captured_at_worker_creation() {
    let (manager, events) = manager();
    let old = manager.session_events("old");
    let new = manager.session_events("new");
    new(RoomEvent::PeerJoined {
        name: "guest".into(),
    });
    old(RoomEvent::Closed {
        reason: GameRoomClosedReason::Closed,
    });
    assert_eq!(events.recv().unwrap().0, "new");
    assert_eq!(events.recv().unwrap().0, "old");
}
