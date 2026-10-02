use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GameRoomStatus {
    /// Local runtime identity; rejoining the same remote room gets a new value.
    pub instance_id: Option<String>,
    /// "idle" | "hosting" | "joined"
    pub phase: String,
    pub room_id: Option<String>,
    pub game_id: Option<String>,
    pub room_name: Option<String>,
    pub host: Option<String>,
    pub port: Option<u16>,
    /// 0 = host (first seat), 1 = guest.
    pub seat: Option<u8>,
    pub player_name: Option<String>,
    pub peer_name: Option<String>,
    pub has_code: bool,
    /// Only present for the host, so the UI can show the code to share.
    pub code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GameRoomSummary {
    pub room_id: String,
    pub game_id: String,
    /// Display names are passthrough discovery metadata: absent or empty
    /// fields stay None and the frontend renders localized placeholders.
    /// The backend must not invent display copy (i18n boundary).
    pub room_name: Option<String>,
    pub host_name: Option<String>,
    pub ip: String,
    pub port: u16,
    pub has_code: bool,
}

/// Existing close notifications are lifecycle reasons, not error payloads.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "kebab-case")]
pub enum GameRoomClosedReason {
    Closed,
    ConnectionLost,
    PeerLeft,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GameRoomPeerEvent {
    pub instance_id: String,
    pub connected: bool,
    // Keep an explicit null on departure for existing event consumers.
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GameRoomClosedEvent {
    pub instance_id: String,
    pub reason: GameRoomClosedReason,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GameRoomMessageEvent {
    pub instance_id: String,
    pub payload: String,
}

#[cfg(test)]
#[path = "model_tests.rs"]
mod tests;
