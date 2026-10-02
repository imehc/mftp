//! Line protocol and connection machinery for game rooms.
//!
//! Newline-delimited JSON over TCP. The host's accept loop handshakes
//! each incoming connection (`hello`/`welcome`/`reject`, or a discovery
//! `probe` answered with `room-info`); after that a reader thread pumps
//! frames and a ping loop keeps liveness observable on both ends.

use parking_lot::Mutex;
use std::io::{BufReader, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::sync::Arc;
use std::time::{Duration, Instant};

pub(super) use super::framing::WireMsg;
use super::framing::{
    encode, read_message, write_frame, HANDSHAKE_FRAME_LIMIT, MESSAGE_FRAME_LIMIT,
};
use super::{runtime::StopSignal, GameRoomClosedReason, RoomEvent, SessionEventSink};
use crate::core::connections::Connections;
use crate::error::AppResult;

// Bound simultaneous handshakes while allowing discovery during a game.
const MAX_CONNECTIONS: usize = 32;
const ACCEPT_POLL: Duration = Duration::from_millis(150);
pub(super) const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(4);
pub(super) const CONNECT_TIMEOUT: Duration = Duration::from_secs(4);
const PING_INTERVAL: Duration = Duration::from_secs(5);
/// Reader gives up after this much silence; pings arrive every 5s.
pub(super) const IDLE_TIMEOUT: Duration = Duration::from_secs(15);

/// Write half of the peer connection; reads happen on a dedicated thread.
pub(super) struct PeerLink {
    stream: Mutex<TcpStream>,
    // Shutdown must never wait for a writer holding the serialization mutex.
    socket: TcpStream,
}

impl PeerLink {
    pub(super) fn new(stream: TcpStream) -> std::io::Result<Self> {
        stream.set_write_timeout(Some(HANDSHAKE_TIMEOUT))?;
        Ok(Self {
            socket: stream.try_clone()?,
            stream: Mutex::new(stream),
        })
    }

    pub(super) fn leave(&self) {
        // A graceful notice is best effort; never queue behind a blocked sender.
        if let Some(mut stream) = self.stream.try_lock() {
            if stream
                .set_write_timeout(Some(Duration::from_millis(100)))
                .is_ok()
            {
                let _ = stream.write_all(b"{\"type\":\"leave\"}\n");
            }
        }
        self.shutdown();
    }

    pub(super) fn send(&self, msg: &WireMsg) -> AppResult<()> {
        // Validate before acquiring the writer or sending any part of a frame.
        let frame = encode(msg)?;
        let deadline = Instant::now() + HANDSHAKE_TIMEOUT;
        let Some(mut stream) = self.stream.try_lock_for(HANDSHAKE_TIMEOUT) else {
            return Err(
                std::io::Error::new(std::io::ErrorKind::TimedOut, "Room writer is busy").into(),
            );
        };
        if let Err(error) = write_frame(&mut stream, &frame, deadline) {
            // A partial frame cannot be retried or followed by another message.
            self.shutdown();
            return Err(error.into());
        }
        Ok(())
    }

    pub(super) fn shutdown(&self) {
        let _ = self.socket.shutdown(Shutdown::Both);
    }
}

#[derive(Clone)]
pub(super) struct HostCtx {
    pub(super) stop: Arc<StopSignal>,
    pub(super) link: Arc<Mutex<Option<Arc<PeerLink>>>>,
    pub(super) peer_name: Arc<Mutex<Option<String>>>,
    pub(super) events: SessionEventSink,
    pub(super) room_id: String,
    pub(super) game_id: String,
    pub(super) room_name: String,
    pub(super) player_name: String,
    pub(super) code: Option<String>,
    pub(super) membership: Arc<Mutex<()>>,
}

pub(super) fn accept_loop(listener: TcpListener, ctx: HostCtx) {
    let mut connections = Connections::default();
    while !ctx.stop.is_stopped() {
        connections.reap();
        match listener.accept() {
            Ok((stream, _)) if connections.len() < MAX_CONNECTIONS => {
                let ctx = ctx.clone();
                let _ = connections.spawn(stream, move |stream| handle_incoming(stream, &ctx));
            }
            Ok(_) => {}
            Err(_) => {
                ctx.stop.wait(ACCEPT_POLL);
            }
        }
    }
    drop(listener);
    drop(connections);
}

/// Handshake an incoming connection; on success park it as the room's
/// single guest. The same tracked connection worker then owns the reader.
fn handle_incoming(stream: TcpStream, ctx: &HostCtx) {
    // BSD/macOS accepted sockets inherit the listener's non-blocking flag;
    // the reader thread needs real blocking reads with SO_RCVTIMEO.
    if stream.set_nonblocking(false).is_err() {
        return;
    }
    let _ = stream.set_nodelay(true);
    if stream.set_read_timeout(Some(HANDSHAKE_TIMEOUT)).is_err() {
        return;
    }
    let Ok(write_half) = stream.try_clone() else {
        return;
    };
    let Ok(candidate) = PeerLink::new(write_half).map(Arc::new) else {
        return;
    };
    let Ok(read_half) = stream.try_clone() else {
        return;
    };
    let mut reader = BufReader::new(read_half);
    let (game_id, code, player_name) = match read_message(
        &mut reader,
        &ctx.stop,
        HANDSHAKE_FRAME_LIMIT,
        HANDSHAKE_TIMEOUT,
    ) {
        // A discovery probe: answer with the room card and hang up.
        Ok(WireMsg::Probe) => {
            let _ = candidate.send(&WireMsg::RoomInfo {
                room_id: ctx.room_id.clone(),
                game_id: ctx.game_id.clone(),
                room_name: ctx.room_name.clone(),
                host_name: ctx.player_name.clone(),
                has_code: ctx.code.is_some(),
            });
            return;
        }
        Ok(WireMsg::Hello {
            game_id,
            code,
            player_name,
        }) => (game_id, code, player_name),
        _ => {
            let _ = candidate.send(&WireMsg::Reject {
                reason: "bad-handshake".to_string(),
            });
            return;
        }
    };

    let reject = |reason: &str| {
        let _ = candidate.send(&WireMsg::Reject {
            reason: reason.to_string(),
        });
    };
    if game_id != ctx.game_id {
        reject("game-mismatch");
        return;
    }
    if normalize_code(code) != ctx.code {
        reject("bad-code");
        return;
    }
    // Membership changes and their events are serialized separately from IO.
    // An old reader cannot clear a new peer or emit PeerLeft after PeerJoined.
    let session = PeerSession {
        ctx,
        peer: candidate.clone(),
    };
    let membership = ctx.membership.lock();
    if ctx.stop.is_stopped() {
        return;
    }
    if ctx.link.lock().is_some() {
        drop(membership);
        reject("room-full");
        return;
    }
    if candidate
        .send(&WireMsg::Welcome {
            room_id: ctx.room_id.clone(),
            room_name: ctx.room_name.clone(),
            peer_name: ctx.player_name.clone(),
        })
        .is_err()
    {
        return;
    }
    if stream.set_read_timeout(Some(IDLE_TIMEOUT)).is_err() {
        return;
    }
    if ctx.stop.is_stopped() {
        return;
    }
    *ctx.link.lock() = Some(candidate.clone());
    *ctx.peer_name.lock() = Some(player_name.clone());
    // The Tauri event sink only emits; it must not synchronously change rooms.
    (ctx.events)(RoomEvent::PeerJoined { name: player_name });
    drop(membership);
    let _ = read_loop(reader, &ctx.stop, &ctx.link, &ctx.events);
    drop(session);
}

struct PeerSession<'a> {
    ctx: &'a HostCtx,
    peer: Arc<PeerLink>,
}

impl Drop for PeerSession<'_> {
    fn drop(&mut self) {
        self.peer.shutdown();
        let _membership = self.ctx.membership.lock();
        let mut link = self.ctx.link.lock();
        if !link
            .as_ref()
            .is_some_and(|peer| Arc::ptr_eq(peer, &self.peer))
        {
            return;
        }
        link.take();
        *self.ctx.peer_name.lock() = None;
        drop(link);
        if !self.ctx.stop.is_stopped() {
            (self.ctx.events)(RoomEvent::PeerLeft);
        }
    }
}

/// Pump incoming lines until the connection dies; returns why it ended.
pub(super) fn read_loop(
    mut reader: BufReader<TcpStream>,
    stop: &StopSignal,
    link: &Mutex<Option<Arc<PeerLink>>>,
    events: &SessionEventSink,
) -> GameRoomClosedReason {
    loop {
        if stop.is_stopped() {
            return GameRoomClosedReason::Closed;
        }
        match read_message(&mut reader, stop, MESSAGE_FRAME_LIMIT, IDLE_TIMEOUT) {
            Ok(msg) => {
                if stop.is_stopped() {
                    return GameRoomClosedReason::Closed;
                }
                match msg {
                    WireMsg::Ping => {
                        let peer = link.lock().clone();
                        if let Some(peer) = peer {
                            if peer.send(&WireMsg::Pong).is_err() {
                                return GameRoomClosedReason::ConnectionLost;
                            }
                        }
                    }
                    WireMsg::App { payload } => events(RoomEvent::Message { payload }),
                    WireMsg::Leave => return GameRoomClosedReason::PeerLeft,
                    WireMsg::Pong => {}
                    // A second handshake or discovery exchange is invalid once joined.
                    _ => return GameRoomClosedReason::ConnectionLost,
                }
            }
            Err(_) => return GameRoomClosedReason::ConnectionLost,
        }
    }
}

pub(super) fn ping_loop(stop: Arc<StopSignal>, link: Arc<Mutex<Option<Arc<PeerLink>>>>) {
    while !stop.wait(PING_INTERVAL) {
        let peer = link.lock().clone();
        if let Some(peer) = peer {
            if peer.send(&WireMsg::Ping).is_err() {
                peer.shutdown();
            }
        }
    }
}

pub(super) fn normalize_code(code: Option<String>) -> Option<String> {
    match code {
        Some(code) => {
            let trimmed = code.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        }
        None => None,
    }
}
