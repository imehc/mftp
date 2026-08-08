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
use std::io::{BufRead, BufReader};
use std::net::{SocketAddr, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;

use crate::models::{GameRoomStatus, GameRoomSummary};

mod discovery;
#[cfg(test)]
mod tests;
mod wire;

use discovery::{bind_room_listener, discover_rooms, lan_ip, run_responder};
use wire::{
    accept_loop, normalize_code, read_loop, spawn_ping_loop, HostCtx, PeerLink, WireMsg,
    CONNECT_TIMEOUT, HANDSHAKE_TIMEOUT, IDLE_TIMEOUT,
};

#[derive(Debug, Clone)]
pub enum RoomEvent {
    PeerJoined {
        name: String,
    },
    PeerLeft,
    /// Opaque payload from the peer webview; never parsed on this side.
    Message {
        payload: String,
    },
    /// Guest only: the room is gone (host left or connection lost).
    Closed {
        reason: String,
    },
}

pub type EventSink = Arc<dyn Fn(RoomEvent) + Send + Sync>;

#[derive(Clone, Copy, PartialEq)]
enum Role {
    Host,
    Guest,
}

struct RoomRuntime {
    role: Role,
    room_id: String,
    game_id: String,
    room_name: String,
    player_name: String,
    code: Option<String>,
    host_ip: String,
    port: u16,
    stop: Arc<AtomicBool>,
    link: Arc<Mutex<Option<Arc<PeerLink>>>>,
    peer_name: Arc<Mutex<Option<String>>>,
}

pub struct GameRoomManager {
    runtime: Mutex<Option<RoomRuntime>>,
    events: EventSink,
}

impl GameRoomManager {
    pub fn new(events: EventSink) -> Self {
        Self {
            runtime: Mutex::new(None),
            events,
        }
    }

    pub fn status(&self) -> GameRoomStatus {
        let guard = self.runtime.lock();
        let Some(runtime) = guard.as_ref() else {
            return GameRoomStatus {
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

    pub fn create(
        &self,
        game_id: String,
        room_name: String,
        code: Option<String>,
        player_name: String,
    ) -> Result<GameRoomStatus, String> {
        self.leave();
        let code = normalize_code(code);
        let listener = bind_room_listener().map_err(|e| format!("无法监听端口: {e}"))?;
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        let host_ip = lan_ip().unwrap_or_else(|| "127.0.0.1".to_string());
        let room_id = uuid::Uuid::new_v4().to_string();

        let stop = Arc::new(AtomicBool::new(false));
        let link: Arc<Mutex<Option<Arc<PeerLink>>>> = Arc::new(Mutex::new(None));
        let peer_name: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));

        {
            let ctx = HostCtx {
                stop: stop.clone(),
                link: link.clone(),
                peer_name: peer_name.clone(),
                events: self.events.clone(),
                room_id: room_id.clone(),
                game_id: game_id.clone(),
                room_name: room_name.clone(),
                player_name: player_name.clone(),
                code: code.clone(),
            };
            thread::spawn(move || accept_loop(listener, ctx));
        }
        {
            let stop = stop.clone();
            let (room_id, game_id, room_name, player_name) = (
                room_id.clone(),
                game_id.clone(),
                room_name.clone(),
                player_name.clone(),
            );
            let (host_ip_c, has_code) = (host_ip.clone(), code.is_some());
            thread::spawn(move || {
                run_responder(
                    stop,
                    room_id,
                    game_id,
                    room_name,
                    player_name,
                    host_ip_c,
                    port,
                    has_code,
                );
            });
        }
        spawn_ping_loop(stop.clone(), link.clone());

        let runtime = RoomRuntime {
            role: Role::Host,
            room_id,
            game_id,
            room_name,
            player_name,
            code,
            host_ip,
            port,
            stop,
            link,
            peer_name,
        };
        *self.runtime.lock() = Some(runtime);
        Ok(self.status())
    }

    pub fn join(
        &self,
        host: String,
        port: u16,
        game_id: String,
        code: Option<String>,
        player_name: String,
    ) -> Result<GameRoomStatus, String> {
        self.leave();
        let addr: SocketAddr = format!("{host}:{port}")
            .parse()
            .map_err(|_| "地址格式不正确".to_string())?;
        let stream = TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT)
            .map_err(|e| format!("无法连接房间: {e}"))?;
        let _ = stream.set_nodelay(true);
        stream
            .set_read_timeout(Some(HANDSHAKE_TIMEOUT))
            .map_err(|e| e.to_string())?;

        let hello = PeerLink {
            stream: Mutex::new(stream.try_clone().map_err(|e| e.to_string())?),
        };
        hello
            .send(&WireMsg::Hello {
                game_id: game_id.clone(),
                code: normalize_code(code),
                player_name: player_name.clone(),
            })
            .map_err(|e| format!("发送握手失败: {e}"))?;

        let mut reader = BufReader::new(stream.try_clone().map_err(|e| e.to_string())?);
        let mut line = String::new();
        reader
            .read_line(&mut line)
            .map_err(|_| "房间无响应".to_string())?;
        let welcome: WireMsg =
            serde_json::from_str(line.trim()).map_err(|_| "房间响应异常".to_string())?;
        let (room_id, room_name, host_name) = match welcome {
            WireMsg::Welcome {
                room_id,
                room_name,
                peer_name,
            } => (room_id, room_name, peer_name),
            WireMsg::Reject { reason } => return Err(reject_message(&reason)),
            _ => return Err("房间响应异常".to_string()),
        };
        let _ = stream.set_read_timeout(Some(IDLE_TIMEOUT));

        let stop = Arc::new(AtomicBool::new(false));
        let peer = Arc::new(PeerLink {
            stream: Mutex::new(stream.try_clone().map_err(|e| e.to_string())?),
        });
        let link = Arc::new(Mutex::new(Some(peer)));
        let peer_name_shared = Arc::new(Mutex::new(Some(host_name)));

        {
            let (stop, link, events) = (stop.clone(), link.clone(), self.events.clone());
            thread::spawn(move || {
                let reason = read_loop(reader, &stop, &link, &events);
                if stop.load(Ordering::SeqCst) {
                    return;
                }
                if let Some(peer) = link.lock().take() {
                    peer.shutdown();
                }
                events(RoomEvent::Closed {
                    reason: reason.to_string(),
                });
            });
        }
        spawn_ping_loop(stop.clone(), link.clone());

        let runtime = RoomRuntime {
            role: Role::Guest,
            room_id,
            game_id,
            room_name,
            player_name,
            code: None,
            host_ip: host,
            port,
            stop,
            link,
            peer_name: peer_name_shared,
        };
        *self.runtime.lock() = Some(runtime);
        Ok(self.status())
    }

    /// Relay an opaque payload to the peer webview.
    pub fn send(&self, payload: String) -> Result<(), String> {
        let link = {
            let guard = self.runtime.lock();
            let runtime = guard.as_ref().ok_or("当前不在房间中")?;
            let link = runtime.link.lock().clone().ok_or("对方未连接")?;
            link
        };
        link.send(&WireMsg::App { payload })
            .map_err(|e| format!("发送失败: {e}"))
    }

    pub fn leave(&self) {
        let Some(runtime) = self.runtime.lock().take() else {
            return;
        };
        runtime.stop.store(true, Ordering::SeqCst);
        let peer = runtime.link.lock().take();
        if let Some(peer) = peer {
            let _ = peer.send(&WireMsg::Leave);
            peer.shutdown();
        }
    }

    pub fn discover(&self, game_id: &str) -> Vec<GameRoomSummary> {
        let own_room = {
            let runtime = self.runtime.lock();
            runtime.as_ref().map(|r| r.room_id.clone())
        };
        discover_rooms(game_id, own_room.as_deref())
    }
}

fn reject_message(reason: &str) -> String {
    match reason {
        "bad-code" => "房间码不正确".to_string(),
        "room-full" => "房间已满".to_string(),
        "game-mismatch" => "房间的游戏类型不匹配".to_string(),
        _ => "加入房间被拒绝".to_string(),
    }
}
