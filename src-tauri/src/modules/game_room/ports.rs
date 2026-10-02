use super::GameRoomClosedReason;
use std::sync::Arc;

#[derive(Debug, Clone)]
pub(crate) enum RoomEvent {
    PeerJoined {
        name: String,
    },
    PeerLeft,
    /// Opaque payload from the peer webview; never parsed on this side.
    Message {
        payload: String,
    },
    /// Guest only: the room is gone (host left or connection lost).
    Closed {
        reason: GameRoomClosedReason,
    },
}

pub(crate) type EventSink = Arc<dyn Fn(&str, RoomEvent) + Send + Sync>;
pub(super) type SessionEventSink = Arc<dyn Fn(RoomEvent) + Send + Sync>;
