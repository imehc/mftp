//! Game-agnostic LAN room service for the mini-games.
//!
//! A host creates a room: a plain TCP listener speaking newline-delimited
//! JSON plus an mDNS advertisement (`_mftp-room._tcp`) carrying the room
//! metadata. A guest browses (mDNS + TCP probe sweep, see `discovery`) or
//! types an address, connects, and passes a hello/welcome handshake with
//! an optional room code (see `wire`). After that the service is a dumb
//! pipe: `App` messages carry opaque string payloads that are relayed to
//! the peer webview untouched — the move/undo/rematch protocol lives
//! entirely in TypeScript (`src/features/games/engine/online/`), so any
//! turn-based game can reuse this layer.
//!
//! Webviews cannot open sockets, so both ends talk to their local Rust
//! side via commands/events and the two Rust processes own the wire.
//! No async runtime: std::net + threads, matching `lan_transfer`.

use parking_lot::Mutex;
use std::sync::Arc;

use super::ports::{EventSink, RoomEvent, SessionEventSink};
use super::{GameRoomClosedReason, GameRoomStatus, GameRoomSummary};
use crate::core::operations::{OperationLease, Operations};
use crate::error::{AppError, AppResult, CustomErrorCode};

mod discovery;
mod framing;
#[cfg(test)]
mod lifecycle_tests;
#[cfg(test)]
mod ownership_tests;
#[cfg(test)]
mod protocol_tests;
mod runtime;
mod session;
#[cfg(test)]
mod tests;
mod wire;

use runtime::{RoomHandle, StopSignal};
use wire::{PeerLink, WireMsg};

#[derive(Clone, Copy, PartialEq)]
enum Role {
    Host,
    Guest,
}

struct RoomRuntime {
    instance_id: String,
    role: Role,
    room_id: String,
    game_id: String,
    room_name: String,
    player_name: String,
    code: Option<String>,
    host_ip: String,
    port: u16,
    link: Arc<Mutex<Option<Arc<PeerLink>>>>,
    peer_name: Arc<Mutex<Option<String>>>,
    handle: Option<RoomHandle>,
}

pub struct GameRoomManager {
    runtime: Mutex<Option<RoomRuntime>>,
    events: EventSink,
    lifecycle: Mutex<()>,
    operations: Arc<Operations>,
    in_flight: Arc<Operations>,
    discovery_stop: Arc<StopSignal>,
}

impl GameRoomManager {
    pub(crate) fn new(events: EventSink, operations: Arc<Operations>) -> Self {
        Self {
            runtime: Mutex::new(None),
            events,
            lifecycle: Mutex::new(()),
            operations,
            in_flight: Arc::new(Operations::default()),
            discovery_stop: Arc::new(StopSignal::default()),
        }
    }

    fn admission(&self) -> AppResult<(OperationLease, OperationLease)> {
        Ok((self.operations.begin()?, self.in_flight.begin()?))
    }

    pub fn status(&self) -> GameRoomStatus {
        let guard = self.runtime.lock();
        let Some(runtime) = guard.as_ref() else {
            return GameRoomStatus {
                instance_id: None,
                phase: "idle".to_string(),
                room_id: None,
                game_id: None,
                room_name: None,
                host: None,
                port: None,
                seat: None,
                player_name: None,
                peer_name: None,
                has_code: false,
                code: None,
            };
        };
        let peer_name = runtime.peer_name.lock().clone();
        GameRoomStatus {
            instance_id: Some(runtime.instance_id.clone()),
            phase: match runtime.role {
                Role::Host => "hosting",
                Role::Guest => "joined",
            }
            .to_string(),
            room_id: Some(runtime.room_id.clone()),
            game_id: Some(runtime.game_id.clone()),
            room_name: Some(runtime.room_name.clone()),
            host: Some(runtime.host_ip.clone()),
            port: Some(runtime.port),
            seat: Some(match runtime.role {
                Role::Host => 0,
                Role::Guest => 1,
            }),
            player_name: Some(runtime.player_name.clone()),
            peer_name,
            has_code: runtime.code.is_some(),
            code: runtime.code.clone(),
        }
    }

    /// Relay an opaque payload. Lifecycle closure also rejects direct callers.
    pub fn send(&self, instance_id: &str, payload: String) -> AppResult<()> {
        let (_shared, _domain) = self.admission()?;
        let link = {
            let guard = self.runtime.lock();
            let runtime = guard
                .as_ref()
                .filter(|runtime| runtime.instance_id == instance_id)
                .ok_or_else(|| AppError::custom(CustomErrorCode::RoomNotJoined))?;
            let link = runtime
                .link
                .lock()
                .clone()
                .ok_or_else(|| AppError::custom(CustomErrorCode::RoomPeerMissing))?;
            link
        };
        link.send(&WireMsg::App { payload })
    }

    pub fn leave(&self) {
        let _lifecycle = self.lifecycle.lock();
        self.stop_runtime();
    }

    pub fn leave_instance(&self, instance_id: &str) {
        // Match and stop under the same lifecycle lock; a stale cleanup cannot
        // close a replacement between a status check and an unconditional leave.
        let _lifecycle = self.lifecycle.lock();
        let matches = self
            .runtime
            .lock()
            .as_ref()
            .is_some_and(|r| r.instance_id == instance_id);
        if matches {
            self.stop_runtime();
        }
    }

    fn session_events(&self, instance_id: &str) -> SessionEventSink {
        let events = self.events.clone();
        let instance_id = instance_id.to_owned();
        // Capture the identity at creation, never read the manager's current run
        // when an old worker finally publishes its event.
        Arc::new(move |event| events(&instance_id, event))
    }

    // Called only with lifecycle held. Keep status non-idle until the generation
    // has released every connection and worker; queued starts cannot overtake it.
    fn stop_runtime(&self) {
        let mut handle = self.runtime.lock().as_mut().and_then(|runtime| {
            let mut handle = runtime.handle.take()?;
            handle.peer = runtime.link.lock().clone();
            Some(handle)
        });
        if let Some(handle) = handle.as_mut() {
            handle.stop_and_join();
        }
        // Drop the runtime's remaining socket references before its operation lease.
        self.runtime.lock().take();
        drop(handle);
    }

    pub fn discover(&self, game_id: &str) -> AppResult<Vec<GameRoomSummary>> {
        let (_shared, _domain) = self.admission()?;
        let own_room = self.runtime.lock().as_ref().map(|r| r.room_id.clone());
        discovery::discover_rooms(game_id, own_room.as_deref(), &self.discovery_stop)
    }

    pub(crate) fn shutdown(&self) {
        self.in_flight.close();
        self.discovery_stop.stop();
        self.leave();
        // Discovery and an already-admitted connect/handshake may still be in
        // progress. No callback completion is reported until those callers exit.
        self.in_flight.wait_until_idle();
    }
}

impl Drop for GameRoomManager {
    fn drop(&mut self) {
        self.shutdown();
    }
}
