use sha2::{Digest, Sha256};
use std::collections::VecDeque;

use crate::{
    error::{AppError, AppResult, CustomErrorCode},
    modules::game_room::{GamePartyEnvelope, GamePartyMessageKind as Kind},
};

pub(super) const VERSION: u16 = 3;

pub(super) fn invalid() -> AppError {
    AppError::custom(CustomErrorCode::RoomHandshakeInvalid)
}

pub(super) fn validate(message: &GamePartyEnvelope, room_id: &str, rules: u32) -> AppResult<()> {
    if message.protocol_version != VERSION
        || message.room_id != room_id
        || message.rules_version != rules
        || uuid::Uuid::parse_str(&message.match_id).is_err()
        || uuid::Uuid::parse_str(&message.action_id).is_err()
        || message.sequence == 0
        || message.generation == 0
        || message.payload.len() > 128 * 1024
    {
        return Err(invalid());
    }
    let value: serde_json::Value = serde_json::from_str(&message.payload).map_err(|_| invalid())?;
    if !value.is_object() {
        return Err(invalid());
    }
    Ok(())
}

#[derive(Default, Clone)]
pub(super) struct Sequence {
    last: u32,
    recent: VecDeque<(String, u32, [u8; 32])>,
}

impl Sequence {
    pub(super) fn accept(&mut self, message: &GamePartyEnvelope) -> AppResult<bool> {
        let identity: [u8; 32] = Sha256::digest(serde_json::to_vec(message)?).into();
        if let Some((_, sequence, previous)) = self
            .recent
            .iter()
            .find(|(id, _, _)| id == &message.action_id)
        {
            if *sequence == message.sequence && previous == &identity {
                return Ok(false);
            }
            return Err(invalid());
        }
        if message.sequence <= self.last {
            return Err(invalid());
        }
        self.last = message.sequence;
        self.recent
            .push_back((message.action_id.clone(), message.sequence, identity));
        // Retain bounded identities only, never authority snapshots beyond this replay window.
        while self.recent.len() > 16 {
            self.recent.pop_front();
        }
        Ok(true)
    }
}

#[derive(Default, Clone)]
pub(super) struct Position {
    pub(super) match_id: Option<String>,
    pub(super) generation: u32,
    pub(super) revision: u32,
}

impl Position {
    pub(super) fn advance(&mut self, message: &GamePartyEnvelope) -> AppResult<()> {
        // Lobby/compatibility negotiation can precede a match without authorizing gameplay.
        if self.match_id.is_none()
            && matches!(message.kind, Kind::Request | Kind::Response)
            && message.revision == 0
        {
            return Ok(());
        }
        if message.kind == Kind::Start {
            if self.match_id.is_some() && message.generation <= self.generation {
                return Err(invalid());
            }
            if message.revision != 0 {
                return Err(invalid());
            }
            self.match_id = Some(message.match_id.clone());
            self.generation = message.generation;
            self.revision = 0;
            return Ok(());
        }
        if self.match_id.as_ref() != Some(&message.match_id)
            || self.generation != message.generation
        {
            return Err(invalid());
        }
        if message.kind == Kind::Commit {
            if message.revision != self.revision.checked_add(1).ok_or_else(invalid)? {
                return Err(invalid());
            }
            self.revision = message.revision;
        } else if message.revision != self.revision {
            return Err(invalid());
        }
        Ok(())
    }

    pub(super) fn check_action(&self, message: &GamePartyEnvelope) -> AppResult<()> {
        if self.match_id.is_none()
            && matches!(message.kind, Kind::Request | Kind::Response)
            && message.revision == 0
        {
            return Ok(());
        }
        // Recovery requests can refer to an older revision; they never authorize gameplay.
        if message.kind == Kind::Request
            && self.match_id.as_ref() == Some(&message.match_id)
            && message.generation == self.generation
            && message.revision <= self.revision
        {
            return Ok(());
        }
        if !matches!(message.kind, Kind::Action | Kind::Request | Kind::Response)
            || self.match_id.as_ref() != Some(&message.match_id)
            || message.generation != self.generation
            || message.revision != self.revision
        {
            return Err(invalid());
        }
        Ok(())
    }
}
