#[cfg(not(test))]
use super::super::discovery::{bind_room_listener, run_responder};
use super::super::{
    discovery::lan_ip,
    framing::{read_message_logged, HANDSHAKE_FRAME_LIMIT, MESSAGE_FRAME_LIMIT},
    runtime::StopSignal,
    wire::{WireMsg, HANDSHAKE_TIMEOUT, IDLE_TIMEOUT},
    GameRoomManager,
};
use super::*;
use crate::{
    core::{connections::Connections, operations::OperationLease},
    modules::game_room::GamePartyCreateInput,
};
use std::{
    io::BufReader,
    net::{TcpListener, TcpStream},
    time::Duration,
};

impl GameRoomManager {
    pub fn create_party(&self, input: GamePartyCreateInput) -> AppResult<GamePartyStatus> {
        validate_create(&input)?;
        let (lease, _domain) = self.admission()?;
        let _lifecycle = self.lifecycle.lock();
        self.operations.check_admission()?;
        self.in_flight.check_admission()?;
        self.stop_runtime();
        let instance_id = uuid::Uuid::new_v4().to_string();
        self.party.host(
            input,
            lease,
            self.logs.clone(),
            self.session_events(&instance_id),
            instance_id,
        )
    }
}

fn validate_create(input: &GamePartyCreateInput) -> AppResult<()> {
    let seats = input
        .remote_seats
        .iter()
        .copied()
        .collect::<std::collections::HashSet<_>>();
    if input.rules_version == 0
        || input.seat_count < 2
        || input.seat_count > 64
        || seats.len() != input.remote_seats.len()
        || seats.is_empty()
        || seats.len() > 31
        || seats.iter().any(|s| *s == 0 || *s >= input.seat_count)
        || input.game_id.is_empty()
        || input.game_id.len() > 80
        || input.room_name.len() > 256
        || input.player_name.len() > 256
        || input.code.as_ref().is_some_and(|c| c.len() > 256)
    {
        return Err(protocol::invalid());
    }
    Ok(())
}

#[derive(Clone)]
struct Host {
    shared: Arc<Mutex<Shared>>,
    stop: Arc<StopSignal>,
    logs: RoomDiagnostics,
    events: SessionEventSink,
}

impl PartyManager {
    fn host(
        &self,
        input: GamePartyCreateInput,
        lease: OperationLease,
        logs: RoomDiagnostics,
        events: SessionEventSink,
        instance_id: String,
    ) -> AppResult<GamePartyStatus> {
        #[cfg(not(test))]
        let listener = bind_room_listener()?;
        #[cfg(test)]
        let listener = TcpListener::bind("127.0.0.1:0")?;
        listener.set_nonblocking(true)?;
        let port = listener.local_addr()?.port();
        let room_id = uuid::Uuid::new_v4().to_string();
        let member_id = uuid::Uuid::new_v4().to_string();
        let mut handle = RoomHandle::new(lease);
        let status = GamePartyStatus {
            instance_id,
            protocol_version: protocol::VERSION,
            room_id,
            game_id: input.game_id,
            rules_version: input.rules_version,
            seat_count: input.seat_count,
            room_name: input.room_name,
            host: lan_ip().unwrap_or_else(|| "127.0.0.1".into()),
            port,
            hosting: true,
            member_id: member_id.clone(),
            seat: 0,
            connected: true,
            connection_generation: 0,
            members: Vec::new(),
            code: super::super::wire::normalize_code(input.code),
        };
        let authority = Member {
            public: GamePartyMember {
                member_id: member_id.clone(),
                seat: 0,
                name: input.player_name,
                connected: true,
                connection_generation: 0,
            },
            device_id: self.device_id.clone(),
            recovery_token: String::new(),
            previous_token: None,
            peer: None,
            sequence: protocol::Sequence::default(),
        };
        let shared = Arc::new(Mutex::new(Shared {
            status: status.clone(),
            members: BTreeMap::from([(member_id, authority)]),
            remote_seats: input.remote_seats,
            position: protocol::Position::default(),
            authority_sequence: protocol::Sequence::default(),
            recovery: None,
            host_peer: None,
            join: None,
            dispatch: Arc::new(Mutex::new(())),
        }));
        let ctx = Host {
            shared: shared.clone(),
            stop: handle.stop.clone(),
            logs: logs.clone(),
            events: events.clone(),
        };
        handle.spawn("party-accept", move || accept(listener, ctx))?;
        #[cfg(not(test))]
        {
            let stop = handle.stop.clone();
            let advertised = status.clone();
            let name = shared.lock().members[&status.member_id].public.name.clone();
            handle.spawn("party-advertise", move || {
                run_responder(
                    stop,
                    advertised.room_id,
                    advertised.game_id,
                    advertised.room_name,
                    name,
                    advertised.host,
                    port,
                    advertised.code.is_some(),
                )
            })?;
        }
        {
            let stop = handle.stop.clone();
            let shared = shared.clone();
            handle.spawn("party-ping", move || {
                while !stop.wait(Duration::from_secs(5)) {
                    let peers = shared
                        .lock()
                        .members
                        .values()
                        .filter_map(|m| m.peer.clone())
                        .collect::<Vec<_>>();
                    for peer in peers {
                        if peer.send(&WireMsg::Ping).is_err() {
                            peer.shutdown();
                        }
                    }
                }
            })?;
        }
        let dispatch = shared.lock().dispatch.clone();
        *self.runtime.lock() = Some(Runtime {
            shared,
            handle: Some(handle),
            dispatch,
        });
        self.status().ok_or_else(protocol::invalid)
    }
}

fn accept(listener: TcpListener, host: Host) {
    let mut connections = Connections::default();
    while !host.stop.is_stopped() {
        connections.reap();
        match listener.accept() {
            Ok((stream, _)) if connections.len() < 32 => {
                let host = host.clone();
                let _ = connections.spawn(stream, move |stream| incoming(stream, &host));
            }
            Ok(_) => {}
            Err(_) => {
                host.stop.wait(Duration::from_millis(100));
            }
        }
    }
}

fn incoming(stream: TcpStream, host: &Host) {
    let result = serve(stream, host);
    if let Err(error) = result {
        crate::runtime_log!("Game party connection ended: {}", error.code);
    }
}

fn serve(stream: TcpStream, host: &Host) -> AppResult<()> {
    stream.set_nonblocking(false)?;
    stream.set_nodelay(true)?;
    let peer = Arc::new(PeerLink::new(stream.try_clone()?)?.with_logs(host.logs.clone()));
    let mut reader = BufReader::new(stream);
    let hello = read_message_logged(
        &mut reader,
        &host.stop,
        HANDSHAKE_FRAME_LIMIT,
        HANDSHAKE_TIMEOUT,
        Some(&host.logs),
    )?;
    if matches!(hello, WireMsg::Probe) {
        let shared = host.shared.lock();
        let status = &shared.status;
        peer.send(&WireMsg::RoomInfo {
            room_id: status.room_id.clone(),
            game_id: status.game_id.clone(),
            room_name: status.room_name.clone(),
            host_name: shared.members[&status.member_id].public.name.clone(),
            has_code: status.code.is_some(),
        })?;
        return Ok(());
    }
    let WireMsg::PartyHello {
        protocol_version,
        game_id,
        rules_version,
        code,
        player_name,
        device_id,
        recovery,
    } = hello
    else {
        peer.send(&WireMsg::Reject {
            reason: "version-mismatch".into(),
        })?;
        return Err(protocol::invalid());
    };
    let admission = join_member(
        host,
        &peer,
        protocol_version,
        &game_id,
        rules_version,
        code,
        player_name,
        device_id,
        recovery,
    );
    let (member_id, generation) = match admission {
        Ok(value) => value,
        Err(error) => {
            let _ = peer.send(&WireMsg::Reject {
                reason: "party-rejected".into(),
            });
            return Err(error);
        }
    };
    let ack = read_message_logged(
        &mut reader,
        &host.stop,
        HANDSHAKE_FRAME_LIMIT,
        HANDSHAKE_TIMEOUT,
        Some(&host.logs),
    );
    let dispatch = host.shared.lock().dispatch.clone();
    let ready = {
        let _dispatch = dispatch.lock();
        let mut shared = host.shared.lock();
        let member = shared
            .members
            .get_mut(&member_id)
            .filter(|m| m.public.connection_generation == generation)
            .ok_or_else(protocol::invalid)?;
        if matches!(ack, Ok(WireMsg::PartyAck { recovery_token }) if recovery_token == member.recovery_token)
        {
            // Ready must precede all membership and gameplay frames on this connection.
            peer.send(&WireMsg::PartyReady).map(|_| {
                member.previous_token = None;
                member.public.connected = true;
            })
        } else {
            Err(protocol::invalid())
        }
    };
    if let Err(error) = ready {
        peer.shutdown();
        disconnect_member(host, &member_id, generation, false);
        return Err(error);
    }
    publish_members(&host.shared, &host.events);
    let result = pump(&mut reader, host, &peer, &member_id, generation);
    peer.shutdown();
    disconnect_member(
        host,
        &member_id,
        generation,
        result.as_ref().is_ok_and(|left| *left),
    );
    result.map(|_| ())
}

fn disconnect_member(host: &Host, member_id: &str, generation: u32, explicit: bool) {
    let changed = {
        let mut shared = host.shared.lock();
        if (explicit
            || shared
                .members
                .get(member_id)
                .is_some_and(|m| !m.public.connected && m.previous_token.is_none()))
            && shared
                .members
                .get(member_id)
                .is_some_and(|m| m.public.connection_generation == generation)
        {
            shared.members.remove(member_id);
            true
        } else if let Some(member) = shared
            .members
            .get_mut(member_id)
            .filter(|m| m.public.connection_generation == generation)
        {
            member.peer = None;
            member.public.connected = false;
            true
        } else {
            false
        }
    };
    if changed && !host.stop.is_stopped() {
        publish_members(&host.shared, &host.events);
    }
}

#[expect(
    clippy::too_many_arguments,
    reason = "Handshake fields are validated together before identity binding"
)]
fn join_member(
    host: &Host,
    peer: &Arc<PeerLink>,
    version: u16,
    game_id: &str,
    rules: u32,
    code: Option<String>,
    name: String,
    device_id: String,
    recovery: Option<Recovery>,
) -> AppResult<(String, u32)> {
    let dispatch = host.shared.lock().dispatch.clone();
    let _dispatch = dispatch.lock();
    let mut shared = host.shared.lock();
    if host.stop.is_stopped()
        || version != protocol::VERSION
        || game_id != shared.status.game_id
        || rules != shared.status.rules_version
        || uuid::Uuid::parse_str(&device_id).is_err()
        || name.len() > 256
    {
        return Err(protocol::invalid());
    }
    // Keep the credential actually presented until ACK, including repeated lost welcome attempts.
    let previous_token = recovery.as_ref().map(|r| r.recovery_token.clone());
    let (member_id, seat, generation) = if let Some(recovery) = recovery {
        let member = shared
            .members
            .get(&recovery.member_id)
            .ok_or_else(protocol::invalid)?;
        if recovery.room_id != shared.status.room_id
            || (recovery.recovery_token != member.recovery_token
                && member.previous_token.as_ref() != Some(&recovery.recovery_token))
            || device_id != member.device_id
            || member.public.seat == 0
        {
            return Err(protocol::invalid());
        }
        (
            recovery.member_id,
            member.public.seat,
            member
                .public
                .connection_generation
                .checked_add(1)
                .ok_or_else(protocol::invalid)?,
        )
    } else {
        if super::super::wire::normalize_code(code) != shared.status.code {
            return Err(AppError::custom(CustomErrorCode::RoomCodeInvalid));
        }
        let seat = shared
            .remote_seats
            .iter()
            .copied()
            .find(|seat| {
                !shared
                    .members
                    .values()
                    .any(|member| member.public.seat == *seat)
            })
            .ok_or_else(|| AppError::custom(CustomErrorCode::RoomFull))?;
        (uuid::Uuid::new_v4().to_string(), seat, 1)
    };
    let token = credential();
    let mut status = snapshot(&shared);
    status.hosting = false;
    status.code = None;
    status.member_id = member_id.clone();
    status.seat = seat;
    status.connection_generation = generation;
    peer.send(&WireMsg::PartyWelcome {
        status,
        recovery_token: token.clone(),
    })?;
    let old = shared.members.remove(&member_id);
    let old_peer = old.as_ref().and_then(|m| m.peer.clone());
    shared.members.insert(
        member_id.clone(),
        Member {
            public: GamePartyMember {
                member_id: member_id.clone(),
                seat,
                name,
                connected: false,
                connection_generation: generation,
            },
            device_id,
            recovery_token: token,
            previous_token,
            peer: Some(peer.clone()),
            sequence: old.map(|m| m.sequence).unwrap_or_default(),
        },
    );
    // Superseded workers can no longer submit or clear this member's new connection.
    if let Some(peer) = old_peer {
        peer.shutdown();
    }
    Ok((member_id, generation))
}

fn pump(
    reader: &mut BufReader<TcpStream>,
    host: &Host,
    peer: &PeerLink,
    member_id: &str,
    generation: u32,
) -> AppResult<bool> {
    while !host.stop.is_stopped() {
        let message = read_message_logged(
            reader,
            &host.stop,
            MESSAGE_FRAME_LIMIT,
            IDLE_TIMEOUT,
            Some(&host.logs),
        )?;
        match message {
            WireMsg::Ping => peer.send(&WireMsg::Pong)?,
            WireMsg::Pong => {}
            WireMsg::Leave => return Ok(true),
            WireMsg::PartyMessage { envelope } => {
                let dispatch = host.shared.lock().dispatch.clone();
                let _dispatch = dispatch.lock();
                let mut shared = host.shared.lock();
                protocol::validate(
                    &envelope,
                    &shared.status.room_id,
                    shared.status.rules_version,
                )?;
                shared.position.check_action(&envelope)?;
                let instance_id = shared.status.instance_id.clone();
                let member = shared
                    .members
                    .get_mut(member_id)
                    .filter(|m| m.public.connected && m.public.connection_generation == generation)
                    .ok_or_else(protocol::invalid)?;
                if !member.sequence.accept(&envelope)? {
                    continue;
                }
                let seat = member.public.seat;
                // Identity is attached from the authenticated connection, never from the payload.
                let event = GamePartyEvent::Message {
                    instance_id,
                    member_id: member_id.to_owned(),
                    seat,
                    connection_generation: generation,
                    envelope,
                };
                drop(shared);
                (host.events)(RoomEvent::Party(event));
            }
            _ => return Err(protocol::invalid()),
        }
    }
    Ok(false)
}
