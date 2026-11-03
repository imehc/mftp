use crate::modules::game_room::{
    ports::{EventSink, RoomEvent},
    GameRoomClosedEvent, GameRoomManager, GameRoomMessageEvent, GameRoomPeerEvent,
};
use std::sync::Arc;
use tauri::Emitter;

pub(crate) fn install(
    app: &tauri::AppHandle,
    operations: Arc<crate::core::operations::Operations>,
    diagnostics: Arc<crate::core::diagnostics::Diagnostics>,
    activity: Arc<dyn crate::core::activity::ActivitySink>,
) -> Arc<GameRoomManager> {
    Arc::new(
        GameRoomManager::new(event_sink(app), operations).with_diagnostics(diagnostics, activity),
    )
}

pub(crate) fn event_sink<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> EventSink {
    let app = app.clone();
    Arc::new(move |instance_id, event| {
        let _ = match event {
            RoomEvent::Party(event) => {
                // Existing two-player views keep their business protocol over verified member transport.
                match &event {
                    crate::modules::game_room::GamePartyEvent::Members {
                        instance_id,
                        local_seat,
                        members,
                    } => {
                        let peer = members
                            .iter()
                            .find(|member| member.seat != *local_seat && member.connected);
                        let _ = app.emit(
                            "game-room://peer",
                            GameRoomPeerEvent {
                                instance_id: instance_id.clone(),
                                connected: peer.is_some(),
                                name: peer.map(|member| member.name.clone()),
                            },
                        );
                    }
                    crate::modules::game_room::GamePartyEvent::Message {
                        instance_id,
                        envelope,
                        ..
                    } => {
                        if matches!(
                            envelope.kind,
                            crate::modules::game_room::GamePartyMessageKind::Request
                                | crate::modules::game_room::GamePartyMessageKind::Response
                        ) && envelope.generation == 1
                            && envelope.revision == 0
                            && envelope.match_id == envelope.room_id
                        {
                            let _ = app.emit(
                                "game-room://message",
                                GameRoomMessageEvent {
                                    instance_id: instance_id.clone(),
                                    payload: envelope.payload.clone(),
                                },
                            );
                        }
                    }
                    crate::modules::game_room::GamePartyEvent::Disconnected {
                        instance_id, ..
                    } => {
                        let _ = app.emit(
                            "game-room://closed",
                            GameRoomClosedEvent {
                                instance_id: instance_id.clone(),
                                reason:
                                    crate::modules::game_room::GameRoomClosedReason::ConnectionLost,
                            },
                        );
                    }
                }
                app.emit("game-room://party", event)
            }
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
