use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GamePartyCreateInput {
    pub game_id: String,
    pub rules_version: u32,
    pub seat_count: u8,
    pub remote_seats: Vec<u8>,
    pub room_name: String,
    pub code: Option<String>,
    pub player_name: String,
}

#[derive(Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GamePartyJoinInput {
    pub host: String,
    pub port: u16,
    pub game_id: String,
    pub rules_version: u32,
    pub code: Option<String>,
    pub player_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GamePartyMember {
    pub member_id: String,
    pub seat: u8,
    pub name: String,
    pub connected: bool,
    pub connection_generation: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GamePartyStatus {
    pub instance_id: String,
    pub protocol_version: u16,
    pub room_id: String,
    pub game_id: String,
    pub rules_version: u32,
    pub seat_count: u8,
    pub room_name: String,
    pub host: String,
    pub port: u16,
    pub hosting: bool,
    pub member_id: String,
    pub seat: u8,
    pub connected: bool,
    pub connection_generation: u32,
    pub members: Vec<GamePartyMember>,
    /// Only the authority can display the share code; recovery credentials stay private.
    pub code: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "kebab-case")]
pub enum GamePartyMessageKind {
    Start,
    Action,
    Commit,
    Snapshot,
    Request,
    Response,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GamePartyEnvelope {
    pub protocol_version: u16,
    pub room_id: String,
    pub match_id: String,
    pub rules_version: u32,
    pub generation: u32,
    pub revision: u32,
    pub action_id: String,
    pub sequence: u32,
    pub kind: GamePartyMessageKind,
    pub payload: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum GamePartyEvent {
    Members {
        instance_id: String,
        local_seat: u8,
        members: Vec<GamePartyMember>,
    },
    Message {
        instance_id: String,
        member_id: String,
        seat: u8,
        connection_generation: u32,
        envelope: GamePartyEnvelope,
    },
    Disconnected {
        instance_id: String,
        connection_generation: u32,
    },
}
