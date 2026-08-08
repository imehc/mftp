//! Line protocol and connection machinery for game rooms.
//!
//! Newline-delimited JSON over TCP. The host's accept loop handshakes
//! each incoming connection (`hello`/`welcome`/`reject`, or a discovery
//! `probe` answered with `room-info`); after that a reader thread pumps
//! frames and a ping loop keeps liveness observable on both ends.

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, ErrorKind, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use super::{EventSink, RoomEvent};

const ACCEPT_POLL: Duration = Duration::from_millis(150);
pub(super) const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(4);
pub(super) const CONNECT_TIMEOUT: Duration = Duration::from_secs(4);
const PING_INTERVAL: Duration = Duration::from_secs(5);
/// Reader gives up after this much silence; pings arrive every 5s.
pub(super) const IDLE_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub(super) enum WireMsg {
    Hello {
        game_id: String,
        code: Option<String>,
        player_name: String,
    },
    Welcome {
        room_id: String,
        room_name: String,
        peer_name: String,
    },
    Reject {
        reason: String,
    },
    App {
        payload: String,
    },
    Ping,
    Pong,
    Leave,
    /// Discovery over plain TCP: a scanner asks, the host answers with
    /// RoomInfo and the connection is dropped without joining.
    Probe,
    RoomInfo {
        room_id: String,
        game_id: String,
        room_name: String,
        host_name: String,
        has_code: bool,
    },
}

/// Write half of the peer connection; reads happen on a dedicated thread.
pub(super) struct PeerLink {
    pub(super) stream: Mutex<TcpStream>,
}

impl PeerLink {
    pub(super) fn send(&self, msg: &WireMsg) -> std::io::Result<()> {
        let mut line = serde_json::to_string(msg).map_err(std::io::Error::other)?;
        line.push('\n');
        let mut stream = self.stream.lock();
        stream.write_all(line.as_bytes())
    }

    pub(super) fn shutdown(&self) {
        let _ = self.stream.lock().shutdown(Shutdown::Both);
    }
}

pub(super) struct HostCtx {
    pub(super) stop: Arc<AtomicBool>,
    pub(super) link: Arc<Mutex<Option<Arc<PeerLink>>>>,
    pub(super) peer_name: Arc<Mutex<Option<String>>>,
    pub(super) events: EventSink,
    pub(super) room_id: String,
    pub(super) game_id: String,
    pub(super) room_name: String,
    pub(super) player_name: String,
    pub(super) code: Option<String>,
}

pub(super) fn accept_loop(listener: TcpListener, ctx: HostCtx) {
    while !ctx.stop.load(Ordering::SeqCst) {
        match listener.accept() {
            Ok((stream, _)) => handle_incoming(stream, &ctx),
            Err(ref e) if e.kind() == ErrorKind::WouldBlock => thread::sleep(ACCEPT_POLL),
            Err(_) => thread::sleep(ACCEPT_POLL),
        }
    }
}

/// Handshake an incoming connection; on success park it as the room's
/// single guest and spawn its reader.
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
    let candidate = Arc::new(PeerLink {
        stream: Mutex::new(write_half),
    });
    let Ok(read_half) = stream.try_clone() else {
        return;
    };
    let mut reader = BufReader::new(read_half);
    let mut line = String::new();
    if reader.read_line(&mut line).is_err() || line.trim().is_empty() {
        return;
    }
    let (game_id, code, player_name) = match serde_json::from_str::<WireMsg>(line.trim()) {
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
    {
        let mut link = ctx.link.lock();
        if link.is_some() {
            drop(link);
            reject("room-full");
            return;
        }
        *link = Some(candidate.clone());
    }
    if candidate
        .send(&WireMsg::Welcome {
            room_id: ctx.room_id.clone(),
            room_name: ctx.room_name.clone(),
            peer_name: ctx.player_name.clone(),
        })
        .is_err()
    {
        *ctx.link.lock() = None;
        return;
    }
    let _ = stream.set_read_timeout(Some(IDLE_TIMEOUT));
    *ctx.peer_name.lock() = Some(player_name.clone());
    (ctx.events)(RoomEvent::PeerJoined { name: player_name });

    let stop = ctx.stop.clone();
    let link = ctx.link.clone();
    let peer_name = ctx.peer_name.clone();
    let events = ctx.events.clone();
    thread::spawn(move || {
        let _ = read_loop(reader, &stop, &link, &events);
        if stop.load(Ordering::SeqCst) {
            return;
        }
        if let Some(peer) = link.lock().take() {
            peer.shutdown();
        }
        *peer_name.lock() = None;
        // The room keeps accepting: a guest may rejoin after a drop.
        events(RoomEvent::PeerLeft);
    });
}

/// Pump incoming lines until the connection dies; returns why it ended.
pub(super) fn read_loop(
    mut reader: BufReader<TcpStream>,
    stop: &AtomicBool,
    link: &Mutex<Option<Arc<PeerLink>>>,
    events: &EventSink,
) -> &'static str {
    let mut line = String::new();
    loop {
        if stop.load(Ordering::SeqCst) {
            return "closed";
        }
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => return "connection-lost",
            Ok(_) => {
                let Ok(msg) = serde_json::from_str::<WireMsg>(line.trim()) else {
                    continue;
                };
                match msg {
                    WireMsg::Ping => {
                        if let Some(peer) = link.lock().clone() {
                            let _ = peer.send(&WireMsg::Pong);
                        }
                    }
                    WireMsg::App { payload } => events(RoomEvent::Message { payload }),
                    WireMsg::Leave => return "peer-left",
                    _ => {}
                }
            }
            Err(ref e) if e.kind() == ErrorKind::WouldBlock || e.kind() == ErrorKind::TimedOut => {
                return "connection-lost"
            }
            Err(_) => return "connection-lost",
        }
    }
}

pub(super) fn spawn_ping_loop(stop: Arc<AtomicBool>, link: Arc<Mutex<Option<Arc<PeerLink>>>>) {
    thread::spawn(move || {
        while !stop.load(Ordering::SeqCst) {
            thread::sleep(PING_INTERVAL);
            if stop.load(Ordering::SeqCst) {
                break;
            }
            let peer = link.lock().clone();
            if let Some(peer) = peer {
                if peer.send(&WireMsg::Ping).is_err() {
                    // Wake the blocked reader so it notices the dead link.
                    peer.shutdown();
                }
            }
        }
    });
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
