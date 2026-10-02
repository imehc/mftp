use crate::modules::game_room::{
    ports::{EventSink, RoomEvent},
    GameRoomClosedEvent, GameRoomManager, GameRoomMessageEvent, GameRoomPeerEvent,
};
use std::sync::Arc;
use tauri::Emitter;

pub(crate) fn install(
    app: &tauri::AppHandle,
    operations: Arc<crate::core::operations::Operations>,
) -> Arc<GameRoomManager> {
    Arc::new(GameRoomManager::new(event_sink(app), operations))
}

pub(crate) fn event_sink<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> EventSink {
    let app = app.clone();
    Arc::new(move |instance_id, event| {
        let _ = match event {
            RoomEvent::PeerJoined { name } => app.emit(
                "game-room://peer",
                GameRoomPeerEvent {
                    instance_id: instance_id.to_owned(),
                    connected: true,
                    name: Some(name),
                },
            ),
            RoomEvent::PeerLeft => app.emit(
                "game-room://peer",
                GameRoomPeerEvent {
                    instance_id: instance_id.to_owned(),
                    connected: false,
                    name: None,
                },
            ),
            // Only local IPC adds an identity; the network payload remains opaque.
            RoomEvent::Message { payload } => app.emit(
                "game-room://message",
                GameRoomMessageEvent {
                    instance_id: instance_id.to_owned(),
                    payload,
                },
            ),
            RoomEvent::Closed { reason } => app.emit(
                "game-room://closed",
                GameRoomClosedEvent {
                    instance_id: instance_id.to_owned(),
                    reason,
                },
            ),
        };
    })
}

#[cfg(all(test, desktop))]
#[path = "room_events_tests.rs"]
mod tests;
