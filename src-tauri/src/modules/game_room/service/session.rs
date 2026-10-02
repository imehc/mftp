use super::discovery::{bind_room_listener, lan_ip, run_responder};
use super::framing::{encode, read_message, validate_metadata, HANDSHAKE_FRAME_LIMIT};
use super::wire::{
    accept_loop, normalize_code, ping_loop, read_loop, HostCtx, CONNECT_TIMEOUT, HANDSHAKE_TIMEOUT,
};
use super::*;
use std::io::BufReader;
use std::net::{SocketAddr, TcpStream};

impl GameRoomManager {
    pub fn create(
        &self,
        game_id: String,
        room_name: String,
        code: Option<String>,
        player_name: String,
    ) -> AppResult<GameRoomStatus> {
        let instance_id = uuid::Uuid::new_v4().to_string();
        let (lease, _domain) = self.admission()?;
        let _lifecycle = self.lifecycle.lock();
        self.in_flight.check_admission()?;
        self.operations.check_admission()?;
        validate_metadata(&[
            &game_id,
            &room_name,
            &player_name,
            code.as_deref().unwrap_or(""),
        ])?;
        let code = normalize_code(code);
        let room_id = uuid::Uuid::new_v4().to_string();
        // Check every metadata response and the required guest hello before
        // replacing a working room with one that no compatible peer can join.
        encode(&WireMsg::Hello {
            game_id: game_id.clone(),
            code: code.clone(),
            player_name: player_name.clone(),
        })?;
        encode(&WireMsg::Welcome {
            room_id: room_id.clone(),
            room_name: room_name.clone(),
            peer_name: player_name.clone(),
        })?;
        encode(&WireMsg::RoomInfo {
            room_id: room_id.clone(),
            game_id: game_id.clone(),
            room_name: room_name.clone(),
            host_name: player_name.clone(),
            has_code: code.is_some(),
        })?;
        self.stop_runtime();
        let listener = bind_room_listener()?;
        listener.set_nonblocking(true)?;
        let port = listener.local_addr()?.port();
        let host_ip = lan_ip().unwrap_or_else(|| "127.0.0.1".into());
        let mut handle = RoomHandle::new(lease);
        let stop = handle.stop.clone();
        let link = Arc::new(Mutex::new(None));
        let peer_name = Arc::new(Mutex::new(None));
        let ctx = HostCtx {
            stop: stop.clone(),
            link: link.clone(),
            peer_name: peer_name.clone(),
            events: self.session_events(&instance_id),
            room_id: room_id.clone(),
            game_id: game_id.clone(),
            room_name: room_name.clone(),
            player_name: player_name.clone(),
            code: code.clone(),
            membership: Arc::new(Mutex::new(())),
        };
        handle.spawn("room-accept", move || accept_loop(listener, ctx))?;
        {
            let stop = stop.clone();
            let (room_id, game_id, room_name, player_name, host_ip) = (
                room_id.clone(),
                game_id.clone(),
                room_name.clone(),
                player_name.clone(),
                host_ip.clone(),
            );
            let has_code = code.is_some();
            handle.spawn("room-advertise", move || {
                run_responder(
                    stop,
                    room_id,
                    game_id,
                    room_name,
                    player_name,
                    host_ip,
                    port,
                    has_code,
                );
            })?;
        }
        let ping_link = link.clone();
        handle.spawn("room-ping", move || ping_loop(stop, ping_link))?;
        *self.runtime.lock() = Some(RoomRuntime {
            instance_id,
            role: Role::Host,
            room_id,
            game_id,
            room_name,
            player_name,
            code,
            host_ip,
            port,
            link,
            peer_name,
            handle: Some(handle),
        });
        Ok(self.status())
    }

    pub fn join(
        &self,
        host: String,
        port: u16,
        game_id: String,
        code: Option<String>,
        player_name: String,
    ) -> AppResult<GameRoomStatus> {
        let instance_id = uuid::Uuid::new_v4().to_string();
        let (lease, _domain) = self.admission()?;
        let _lifecycle = self.lifecycle.lock();
        self.in_flight.check_admission()?;
        self.operations.check_admission()?;
        validate_metadata(&[&game_id, &player_name, code.as_deref().unwrap_or("")])?;
        let hello = WireMsg::Hello {
            game_id: game_id.clone(),
            code: normalize_code(code),
            player_name: player_name.clone(),
        };
        encode(&hello)?;
        let addr: SocketAddr = format!("{host}:{port}")
            .parse()
            .map_err(|_| AppError::custom(CustomErrorCode::RoomAddressInvalid))?;
        self.stop_runtime();
        let stream = TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT)?;
        let _ = stream.set_nodelay(true);
        stream.set_read_timeout(Some(HANDSHAKE_TIMEOUT))?;
        let mut handle = RoomHandle::new(lease);
        let peer = Arc::new(PeerLink::new(stream.try_clone()?)?);
        handle.peer = Some(peer.clone());
        peer.send(&hello)?;
        let mut reader = BufReader::new(stream);
        let welcome = read_message(
            &mut reader,
            &handle.stop,
            HANDSHAKE_FRAME_LIMIT,
            HANDSHAKE_TIMEOUT,
        )?;
        let (room_id, room_name, host_name) = match welcome {
            WireMsg::Welcome {
                room_id,
                room_name,
                peer_name,
            } => (room_id, room_name, peer_name),
            WireMsg::Reject { reason } => return Err(reject_error(&reason)),
            _ => return Err(AppError::custom(CustomErrorCode::RoomHandshakeInvalid)),
        };
        let stop = handle.stop.clone();
        let link = Arc::new(Mutex::new(Some(peer)));
        let peer_name = Arc::new(Mutex::new(Some(host_name)));
        {
            let (stop, link, events) = (
                stop.clone(),
                link.clone(),
                self.session_events(&instance_id),
            );
            handle.spawn("room-reader", move || {
                let reason = read_loop(reader, &stop, &link, &events);
                if let Some(peer) = link.lock().take() {
                    peer.shutdown();
                }
                if !stop.is_stopped() {
                    events(RoomEvent::Closed { reason });
                }
            })?;
        }
        let ping_link = link.clone();
        handle.spawn("room-ping", move || ping_loop(stop, ping_link))?;
        *self.runtime.lock() = Some(RoomRuntime {
            instance_id,
            role: Role::Guest,
            room_id,
            game_id,
            room_name,
            player_name,
            code: None,
            host_ip: host,
            port,
            link,
            peer_name,
            handle: Some(handle),
        });
        Ok(self.status())
    }
}

fn reject_error(reason: &str) -> AppError {
    AppError::custom(match reason {
        "bad-code" => CustomErrorCode::RoomCodeInvalid,
        "room-full" => CustomErrorCode::RoomFull,
        "game-mismatch" => CustomErrorCode::RoomGameMismatch,
        _ => CustomErrorCode::RoomJoinRejected,
    })
}
