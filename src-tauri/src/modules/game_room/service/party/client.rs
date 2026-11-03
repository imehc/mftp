use super::super::{
    framing::{read_message_logged, HANDSHAKE_FRAME_LIMIT, MESSAGE_FRAME_LIMIT},
    wire::{WireMsg, CONNECT_TIMEOUT, HANDSHAKE_TIMEOUT, IDLE_TIMEOUT},
    GameRoomManager,
};
use super::*;
use crate::{
    core::operations::OperationLease,
    modules::game_room::{GamePartyJoinInput, GamePartyMessageKind},
};
use std::{
    io::BufReader,
    net::{SocketAddr, TcpStream},
    time::Duration,
};

impl GameRoomManager {
    pub fn party_status(&self) -> Option<GamePartyStatus> {
        self.party.status()
    }

    pub fn join_party(&self, input: GamePartyJoinInput) -> AppResult<GamePartyStatus> {
        validate_join(&input)?;
        let (lease, _domain) = self.admission()?;
        let _lifecycle = self.lifecycle.lock();
        self.operations.check_admission()?;
        self.in_flight.check_admission()?;
        self.stop_runtime();
        let instance_id = uuid::Uuid::new_v4().to_string();
        self.party.connect(
            input,
            None,
            lease,
            self.logs.clone(),
            self.session_events(&instance_id),
            instance_id,
        )
    }

    pub fn resume_party(&self, instance_id: &str) -> AppResult<GamePartyStatus> {
        let (lease, _domain) = self.admission()?;
        let _lifecycle = self.lifecycle.lock();
        self.operations.check_admission()?;
        self.in_flight.check_admission()?;
        let (input, recovery) = {
            let guard = self.party.runtime.lock();
            let runtime = guard
                .as_ref()
                .filter(|r| r.shared.lock().status.instance_id == instance_id)
                .ok_or_else(protocol::invalid)?;
            let shared = runtime.shared.lock();
            (
                shared.join.clone().ok_or_else(protocol::invalid)?,
                shared.recovery.clone().ok_or_else(protocol::invalid)?,
            )
        };
        self.party.connect(
            input,
            Some(recovery),
            lease,
            self.logs.clone(),
            self.session_events(instance_id),
            instance_id.to_owned(),
        )
    }

    pub fn send_party(
        &self,
        instance_id: &str,
        target_member_id: Option<String>,
        envelope: GamePartyEnvelope,
    ) -> AppResult<()> {
        let (_shared, _domain) = self.admission()?;
        self.party.send(instance_id, target_member_id, envelope)
    }
}

fn validate_join(input: &GamePartyJoinInput) -> AppResult<()> {
    if input.rules_version == 0
        || input.game_id.is_empty()
        || input.game_id.len() > 80
        || input.player_name.len() > 256
        || input.code.as_ref().is_some_and(|c| c.len() > 256)
    {
        return Err(protocol::invalid());
    }
    Ok(())
}

impl PartyManager {
    pub(super) fn connect(
        &self,
        mut input: GamePartyJoinInput,
        recovery: Option<Recovery>,
        lease: OperationLease,
        logs: RoomDiagnostics,
        events: SessionEventSink,
        instance_id: String,
    ) -> AppResult<GamePartyStatus> {
        let address: SocketAddr = format!("{}:{}", input.host, input.port)
            .parse()
            .map_err(|_| AppError::custom(CustomErrorCode::RoomAddressInvalid))?;
        let connected =
            TcpStream::connect_timeout(&address, CONNECT_TIMEOUT).map_err(AppError::from);
        logs.frame(
            "connect",
            &address.to_string(),
            &[],
            true,
            connected.as_ref().err(),
        );
        let stream = connected?;
        stream.set_nodelay(true)?;
        let peer = Arc::new(PeerLink::new(stream.try_clone()?)?.with_logs(logs.clone()));
        peer.send(&WireMsg::PartyHello {
            protocol_version: protocol::VERSION,
            game_id: input.game_id.clone(),
            rules_version: input.rules_version,
            code: input.code.clone(),
            player_name: input.player_name.clone(),
            device_id: self.device_id.clone(),
            recovery: recovery.clone(),
        })?;
        let mut handle = RoomHandle::new(lease);
        handle.peer = Some(peer.clone());
        let mut reader = BufReader::new(stream);
        let welcome = read_message_logged(
            &mut reader,
            &handle.stop,
            HANDSHAKE_FRAME_LIMIT,
            HANDSHAKE_TIMEOUT,
            Some(&logs),
        )?;
        let WireMsg::PartyWelcome {
            mut status,
            recovery_token,
        } = welcome
        else {
            return Err(protocol::invalid());
        };
        if status.protocol_version != protocol::VERSION
            || status.game_id != input.game_id
            || status.rules_version != input.rules_version
            || status.seat == 0
            || status.seat_count < 2
            || status.seat_count > 64
            || status.connection_generation == 0
            || status.seat >= status.seat_count
            || status.code.is_some()
            || recovery_token.len() != 64
            || !recovery_token.bytes().all(|b| b.is_ascii_hexdigit())
            || uuid::Uuid::parse_str(&status.room_id).is_err()
            || uuid::Uuid::parse_str(&status.member_id).is_err()
            || recovery
                .as_ref()
                .is_some_and(|r| r.room_id != status.room_id || r.member_id != status.member_id)
        {
            return Err(protocol::invalid());
        }
        validate_members(&status.members, &status, false)?;
        status.instance_id = instance_id;
        status.hosting = false;
        status.host = input.host.clone();
        status.port = input.port;
        status.connected = false;
        let recovery = Recovery {
            room_id: status.room_id.clone(),
            member_id: status.member_id.clone(),
            recovery_token: recovery_token.clone(),
        };
        // Explicit reconnection retains the runtime identity, rotates credentials and never replays actions.
        self.leave();
        input.code = None;
        let shared = Arc::new(Mutex::new(Shared {
            status: status.clone(),
            members: BTreeMap::new(),
            remote_seats: Vec::new(),
            position: protocol::Position::default(),
            authority_sequence: protocol::Sequence::default(),
            recovery: Some(recovery),
            host_peer: Some(peer.clone()),
            join: Some(input),
            dispatch: Arc::new(Mutex::new(())),
        }));
        let dispatch = shared.lock().dispatch.clone();
        *self.runtime.lock() = Some(Runtime {
            shared: shared.clone(),
            handle: None,
            dispatch: dispatch.clone(),
        });
        // Retain the rotated credential before acknowledging; a lost ready frame can be recovered explicitly.
        let acknowledged = (|| -> AppResult<()> {
            peer.send(&WireMsg::PartyAck { recovery_token })?;
            match read_message_logged(
                &mut reader,
                &handle.stop,
                HANDSHAKE_FRAME_LIMIT,
                HANDSHAKE_TIMEOUT,
                Some(&logs),
            )? {
                WireMsg::PartyReady => Ok(()),
                _ => Err(protocol::invalid()),
            }
        })();
        if let Err(error) = acknowledged {
            peer.shutdown();
            if let Some(runtime) = self.runtime.lock().as_mut() {
                runtime.handle = Some(handle);
            }
            return Err(error);
        }
        status.connected = true;
        shared.lock().status.connected = true;
        {
            let stop = handle.stop.clone();
            let shared = shared.clone();
            let events = events.clone();
            let logs = logs.clone();
            let peer = peer.clone();
            handle.spawn("party-reader", move || {
                let _ = receive(&mut reader, &stop, &shared, &peer, &logs, &events);
                peer.shutdown();
                let (instance_id, connection_generation) = {
                    let mut shared = shared.lock();
                    shared.host_peer = None;
                    shared.status.connected = false;
                    (
                        shared.status.instance_id.clone(),
                        shared.status.connection_generation,
                    )
                };
                if !stop.is_stopped() {
                    events(RoomEvent::Party(GamePartyEvent::Disconnected {
                        instance_id,
                        connection_generation,
                    }));
                }
            })?;
        }
        let stop = handle.stop.clone();
        handle.spawn("party-ping", move || {
            while !stop.wait(Duration::from_secs(5)) {
                if peer.send(&WireMsg::Ping).is_err() {
                    peer.shutdown();
                    break;
                }
            }
        })?;
        *self.runtime.lock() = Some(Runtime {
            shared,
            handle: Some(handle),
            dispatch,
        });
        Ok(status)
    }
}

fn receive(
    reader: &mut BufReader<TcpStream>,
    stop: &super::super::runtime::StopSignal,
    shared: &Arc<Mutex<Shared>>,
    peer: &PeerLink,
    logs: &RoomDiagnostics,
    events: &SessionEventSink,
) -> AppResult<()> {
    while !stop.is_stopped() {
        match read_message_logged(reader, stop, MESSAGE_FRAME_LIMIT, IDLE_TIMEOUT, Some(logs))? {
            WireMsg::Ping => peer.send(&WireMsg::Pong)?,
            WireMsg::Pong => {}
            WireMsg::Leave => return Ok(()),
            WireMsg::PartyMembers { members } => {
                let mut guard = shared.lock();
                validate_members(&members, &guard.status, true)?;
                guard.status.members = members.clone();
                let instance_id = guard.status.instance_id.clone();
                let local_seat = guard.status.seat;
                drop(guard);
                events(RoomEvent::Party(GamePartyEvent::Members {
                    instance_id,
                    local_seat,
                    members,
                }));
            }
            WireMsg::PartyMessage { envelope } => {
                let mut guard = shared.lock();
                protocol::validate(&envelope, &guard.status.room_id, guard.status.rules_version)?;
                if !guard.authority_sequence.accept(&envelope)? {
                    continue;
                }
                if envelope.kind == GamePartyMessageKind::Snapshot {
                    if guard.position.match_id.is_some()
                        && envelope.generation < guard.position.generation
                    {
                        return Err(protocol::invalid());
                    }
                    guard.position = protocol::Position {
                        match_id: Some(envelope.match_id.clone()),
                        generation: envelope.generation,
                        revision: envelope.revision,
                    };
                } else {
                    guard.position.advance(&envelope)?;
                }
                let host = guard
                    .status
                    .members
                    .iter()
                    .find(|m| m.seat == 0)
                    .ok_or_else(protocol::invalid)?;
                let event = GamePartyEvent::Message {
                    instance_id: guard.status.instance_id.clone(),
                    member_id: host.member_id.clone(),
                    seat: 0,
                    connection_generation: host.connection_generation,
                    envelope,
                };
                drop(guard);
                events(RoomEvent::Party(event));
            }
            _ => return Err(protocol::invalid()),
        }
    }
    Ok(())
}

fn validate_members(
    members: &[GamePartyMember],
    status: &GamePartyStatus,
    require_self: bool,
) -> AppResult<()> {
    let mut seats = std::collections::HashSet::new();
    let mut ids = std::collections::HashSet::new();
    if members.len() > 32
        || !members.iter().any(|m| m.seat == 0 && m.connected)
        || (require_self
            && !members.iter().any(|m| {
                m.member_id == status.member_id
                    && m.seat == status.seat
                    && m.connection_generation == status.connection_generation
                    && m.connected
            }))
        || members.iter().any(|m| {
            m.seat >= status.seat_count
                || m.name.len() > 256
                || uuid::Uuid::parse_str(&m.member_id).is_err()
                || !seats.insert(m.seat)
                || !ids.insert(&m.member_id)
                || (m.seat != 0 && m.connection_generation == 0)
        })
    {
        return Err(protocol::invalid());
    }
    Ok(())
}
