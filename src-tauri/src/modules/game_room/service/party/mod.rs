use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, sync::Arc};

use super::{
    diagnostics::RoomDiagnostics, runtime::RoomHandle, wire::PeerLink, RoomEvent, SessionEventSink,
};
use crate::{
    error::{AppError, AppResult, CustomErrorCode},
    modules::game_room::{
        GamePartyEnvelope, GamePartyEvent, GamePartyJoinInput, GamePartyMember, GamePartyStatus,
    },
};

mod client;
mod host;
mod protocol;
#[cfg(test)]
mod tests;

// Credentials never cross IPC, public snapshots or Query caches.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(in crate::modules::game_room::service) struct Recovery {
    room_id: String,
    member_id: String,
    recovery_token: String,
}

struct Member {
    public: GamePartyMember,
    device_id: String,
    recovery_token: String,
    previous_token: Option<String>,
    peer: Option<Arc<PeerLink>>,
    sequence: protocol::Sequence,
}

struct Shared {
    status: GamePartyStatus,
    members: BTreeMap<String, Member>,
    remote_seats: Vec<u8>,
    position: protocol::Position,
    authority_sequence: protocol::Sequence,
    recovery: Option<Recovery>,
    host_peer: Option<Arc<PeerLink>>,
    join: Option<GamePartyJoinInput>,
    dispatch: Arc<Mutex<()>>,
}

struct Runtime {
    shared: Arc<Mutex<Shared>>,
    handle: Option<RoomHandle>,
    dispatch: Arc<Mutex<()>>,
}

pub(super) struct PartyManager {
    runtime: Mutex<Option<Runtime>>,
    device_id: String,
}

impl Default for PartyManager {
    fn default() -> Self {
        Self {
            runtime: Mutex::new(None),
            device_id: uuid::Uuid::new_v4().to_string(),
        }
    }
}

impl PartyManager {
    pub(super) fn status(&self) -> Option<GamePartyStatus> {
        self.runtime
            .lock()
            .as_ref()
            .map(|runtime| snapshot(&runtime.shared.lock()))
    }

    pub(super) fn leave(&self) {
        let mut guard = self.runtime.lock();
        let Some(runtime) = guard.as_mut() else {
            return;
        };
        let peers = {
            let shared = runtime.shared.lock();
            shared
                .members
                .values()
                .filter_map(|m| m.peer.clone())
                .chain(shared.host_peer.clone())
                .collect::<Vec<_>>()
        };
        let mut handle = runtime.handle.take();
        // Keep the runtime visible until every tracked worker exits.
        drop(guard);
        if let Some(handle) = handle.as_mut() {
            handle.stop.stop();
        }
        for peer in peers {
            peer.leave();
        }
        if let Some(handle) = handle.as_mut() {
            handle.stop_and_join();
        }
        self.runtime.lock().take();
    }

    pub(super) fn matches(&self, instance_id: &str) -> bool {
        self.runtime
            .lock()
            .as_ref()
            .is_some_and(|r| r.shared.lock().status.instance_id == instance_id)
    }

    pub(super) fn send(
        &self,
        instance_id: &str,
        target: Option<String>,
        envelope: GamePartyEnvelope,
    ) -> AppResult<()> {
        let guard = self.runtime.lock();
        let runtime = guard
            .as_ref()
            .filter(|r| r.shared.lock().status.instance_id == instance_id)
            .ok_or_else(|| AppError::custom(CustomErrorCode::RoomNotJoined))?;
        let dispatch = runtime.dispatch.clone();
        let _dispatch = dispatch.lock();
        let mut shared = runtime.shared.lock();
        protocol::validate(
            &envelope,
            &shared.status.room_id,
            shared.status.rules_version,
        )?;
        let peers = if shared.status.hosting {
            if envelope.kind == crate::modules::game_room::GamePartyMessageKind::Action
                || (target.is_some()
                    && matches!(
                        envelope.kind,
                        crate::modules::game_room::GamePartyMessageKind::Start
                            | crate::modules::game_room::GamePartyMessageKind::Commit
                    ))
            {
                return Err(protocol::invalid());
            }
            if envelope.kind == crate::modules::game_room::GamePartyMessageKind::Snapshot
                && target.is_none()
            {
                return Err(protocol::invalid());
            }
            let mut sequence = shared.authority_sequence.clone();
            if !sequence.accept(&envelope)? {
                return Ok(());
            }
            let mut next = shared.position.clone();
            next.advance(&envelope)?;
            let peers = match target {
                Some(id) => vec![shared
                    .members
                    .get(&id)
                    .filter(|m| m.public.connected)
                    .and_then(|m| m.peer.clone())
                    .ok_or_else(|| AppError::custom(CustomErrorCode::RoomPeerMissing))?],
                None => shared
                    .members
                    .values()
                    .filter(|m| m.public.connected)
                    .filter_map(|m| m.peer.clone())
                    .collect(),
            };
            shared.authority_sequence = sequence;
            shared.position = next;
            peers
        } else {
            if target.is_some() {
                return Err(protocol::invalid());
            }
            shared.position.check_action(&envelope)?;
            vec![shared
                .host_peer
                .clone()
                .ok_or_else(|| AppError::custom(CustomErrorCode::RoomPeerMissing))?]
        };
        // Serialize authority commits with membership without holding locks across socket IO.
        drop(shared);
        drop(guard);
        let mut error = None;
        for peer in peers {
            if let Err(failed) = peer.send(&super::wire::WireMsg::PartyMessage {
                envelope: envelope.clone(),
            }) {
                if error.is_none() {
                    error = Some(failed);
                }
            }
        }
        error.map_or(Ok(()), Err)
    }
}

fn snapshot(shared: &Shared) -> GamePartyStatus {
    let mut status = shared.status.clone();
    if status.hosting {
        status.members = shared.members.values().map(|m| m.public.clone()).collect();
    }
    status.members.sort_by_key(|m| m.seat);
    status
}

fn publish_members(shared: &Arc<Mutex<Shared>>, events: &SessionEventSink) {
    let dispatch = shared.lock().dispatch.clone();
    let _dispatch = dispatch.lock();
    let (instance_id, local_seat, members, peers) = {
        let shared = shared.lock();
        let status = snapshot(&shared);
        (
            status.instance_id,
            status.seat,
            status.members,
            shared
                .members
                .values()
                .filter(|m| m.public.connected)
                .filter_map(|m| m.peer.clone())
                .collect::<Vec<_>>(),
        )
    };
    events(RoomEvent::Party(GamePartyEvent::Members {
        instance_id,
        local_seat,
        members: members.clone(),
    }));
    for peer in peers {
        let _ = peer.send(&super::wire::WireMsg::PartyMembers {
            members: members.clone(),
        });
    }
}

fn credential() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}
