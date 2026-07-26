//! Room discovery: mDNS advertisement/browse plus the TCP probe sweep.
//!
//! mDNS is instant between desktops but relies on multicast, which iOS
//! gates behind a special entitlement and many Android ROMs drop. The
//! sweep probes the local /24 subnets on a fixed port range with plain
//! unicast TCP — it needs no permissions and works wherever direct
//! connect works. `discover_rooms` runs both and merges the results.

use local_ip_address::list_afinet_netifas;
use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use crate::models::GameRoomSummary;

use super::wire::WireMsg;

const SERVICE_TYPE: &str = "_mftp-room._tcp.local.";
/// Rooms bind the first free port in [BASE_PORT, BASE_PORT+PORT_SPAN) so
/// peers can discover them by TCP probe.
pub(super) const BASE_PORT: u16 = 27183;
pub(super) const PORT_SPAN: u16 = 8;
/// Probe sweep only covers the first few ports; same-machine extra rooms
/// beyond that are still reachable via mDNS or direct connect.
const SWEEP_PORTS: u16 = 4;
const SWEEP_CONNECT_TIMEOUT: Duration = Duration::from_millis(250);
const PROBE_IO_TIMEOUT: Duration = Duration::from_millis(600);
const SWEEP_THREADS: usize = 128;
const DISCOVER_WINDOW: Duration = Duration::from_millis(1200);

/// Bind the first free port of the discovery range; ephemeral fallback
/// keeps room creation working even with the whole range occupied (such a
/// room is then only found via mDNS or direct connect).
pub(super) fn bind_room_listener() -> std::io::Result<TcpListener> {
    for offset in 0..PORT_SPAN {
        if let Ok(listener) = TcpListener::bind((Ipv4Addr::UNSPECIFIED, BASE_PORT + offset)) {
            return Ok(listener);
        }
    }
    TcpListener::bind((Ipv4Addr::UNSPECIFIED, 0))
}

/// Browse mDNS and sweep the LAN concurrently; merge on room id.
pub(super) fn discover_rooms(game_id: &str, exclude_room: Option<&str>) -> Vec<GameRoomSummary> {
    let sweep = {
        let game_id = game_id.to_string();
        thread::spawn(move || sweep_lan(&game_id))
    };
    let mut rooms = HashMap::<String, GameRoomSummary>::new();
    if let Ok(daemon) = ServiceDaemon::new() {
        if let Ok(receiver) = daemon.browse(SERVICE_TYPE) {
            let started = Instant::now();
            while started.elapsed() < DISCOVER_WINDOW {
                match receiver.recv_timeout(Duration::from_millis(180)) {
                    Ok(ServiceEvent::ServiceResolved(info)) => {
                        let prop =
                            |key: &str| info.get_property_val_str(key).map(str::to_string);
                        let (Some(room_id), Some(room_game)) = (prop("id"), prop("game"))
                        else {
                            continue;
                        };
                        if room_game != game_id {
                            continue;
                        }
                        let Some(ip) = prop("ip").or_else(|| {
                            info.get_addresses_v4()
                                .into_iter()
                                .next()
                                .map(|ip| ip.to_string())
                        }) else {
                            continue;
                        };
                        rooms.insert(
                            room_id.clone(),
                            GameRoomSummary {
                                room_id,
                                game_id: room_game,
                                room_name: prop("name").unwrap_or_else(|| "房间".to_string()),
                                host_name: prop("host").unwrap_or_else(|| "玩家".to_string()),
                                ip,
                                port: info.get_port(),
                                has_code: prop("code").as_deref() == Some("1"),
                            },
                        );
                    }
                    Ok(_) | Err(_) => {}
                }
            }
        }
        let _ = daemon.shutdown();
    }
    if let Ok(swept) = sweep.join() {
        for room in swept {
            rooms.entry(room.room_id.clone()).or_insert(room);
        }
    }
    if let Some(own) = exclude_room {
        rooms.remove(own);
    }
    let mut rooms = rooms.into_values().collect::<Vec<_>>();
    rooms.sort_by(|a, b| a.room_name.cmp(&b.room_name).then_with(|| a.ip.cmp(&b.ip)));
    rooms
}

/// Advertise the room over mDNS until `stop` is set.
#[allow(clippy::too_many_arguments)]
pub(super) fn run_responder(
    stop: Arc<AtomicBool>,
    room_id: String,
    game_id: String,
    room_name: String,
    host_name: String,
    ip: String,
    port: u16,
    has_code: bool,
) {
    let Ok(daemon) = ServiceDaemon::new() else {
        return;
    };
    let instance = format!("room-{}", &room_id[..8.min(room_id.len())]);
    let mdns_host = format!("mftp-room-{port}.local.");
    let properties = [
        ("id", room_id.as_str()),
        ("game", game_id.as_str()),
        ("name", room_name.as_str()),
        ("host", host_name.as_str()),
        ("ip", ip.as_str()),
        ("code", if has_code { "1" } else { "0" }),
    ];
    let Ok(info) = ServiceInfo::new(
        SERVICE_TYPE,
        &instance,
        &mdns_host,
        ip.as_str(),
        port,
        &properties[..],
    ) else {
        let _ = daemon.shutdown();
        return;
    };
    let fullname = info.get_fullname().to_string();
    if daemon.register(info).is_err() {
        let _ = daemon.shutdown();
        return;
    }
    while !stop.load(Ordering::SeqCst) {
        thread::sleep(Duration::from_millis(300));
    }
    let _ = daemon.unregister(&fullname);
    let _ = daemon.shutdown();
}

/// Probe one address for a room card. Plain unicast TCP — needs no
/// permissions anywhere, works wherever direct connect works.
pub(super) fn probe_room(addr: SocketAddr) -> Option<GameRoomSummary> {
    let stream = TcpStream::connect_timeout(&addr, SWEEP_CONNECT_TIMEOUT).ok()?;
    let _ = stream.set_nodelay(true);
    let _ = stream.set_read_timeout(Some(PROBE_IO_TIMEOUT));
    let _ = stream.set_write_timeout(Some(PROBE_IO_TIMEOUT));
    let mut line = serde_json::to_string(&WireMsg::Probe).ok()?;
    line.push('\n');
    (&stream).write_all(line.as_bytes()).ok()?;
    let mut reader = BufReader::new(stream);
    let mut reply = String::new();
    reader.read_line(&mut reply).ok()?;
    match serde_json::from_str::<WireMsg>(reply.trim()).ok()? {
        WireMsg::RoomInfo {
            room_id,
            game_id,
            room_name,
            host_name,
            has_code,
        } => Some(GameRoomSummary {
            room_id,
            game_id,
            room_name,
            host_name,
            ip: addr.ip().to_string(),
            port: addr.port(),
            has_code,
        }),
        _ => None,
    }
}

/// The /24 subnets of the machine's private IPv4 interfaces (capped at 2).
fn sweep_subnets() -> Vec<Ipv4Addr> {
    let mut subnets = Vec::new();
    let Ok(interfaces) = list_afinet_netifas() else {
        return subnets;
    };
    for (_, ip) in interfaces {
        let IpAddr::V4(ip) = ip else { continue };
        if ip.is_loopback() || !ip.is_private() {
            continue;
        }
        let [a, b, c, _] = ip.octets();
        let base = Ipv4Addr::new(a, b, c, 0);
        if !subnets.contains(&base) {
            subnets.push(base);
        }
        if subnets.len() >= 2 {
            break;
        }
    }
    subnets
}

/// Scan the local subnets' fixed port range for rooms of `game_id`.
/// Worst case ~1000 connect attempts per subnet at 250ms timeout across
/// 128 threads ≈ 2s — bounded by the lobby's sequential polling.
fn sweep_lan(game_id: &str) -> Vec<GameRoomSummary> {
    let mut targets: Vec<SocketAddr> = Vec::new();
    for base in sweep_subnets() {
        let [a, b, c, _] = base.octets();
        for host in 1..=254u8 {
            for offset in 0..SWEEP_PORTS {
                targets.push(SocketAddr::from((
                    Ipv4Addr::new(a, b, c, host),
                    BASE_PORT + offset,
                )));
            }
        }
    }
    if targets.is_empty() {
        return Vec::new();
    }
    let targets = Arc::new(Mutex::new(targets));
    let found: Arc<Mutex<Vec<GameRoomSummary>>> = Arc::new(Mutex::new(Vec::new()));
    let mut workers = Vec::new();
    for _ in 0..SWEEP_THREADS {
        let targets = targets.clone();
        let found = found.clone();
        let game_id = game_id.to_string();
        workers.push(thread::spawn(move || loop {
            let Some(addr) = targets.lock().pop() else {
                return;
            };
            if let Some(room) = probe_room(addr) {
                if room.game_id == game_id {
                    found.lock().push(room);
                }
            }
        }));
    }
    for worker in workers {
        let _ = worker.join();
    }
    let rooms = found.lock().clone();
    rooms
}

pub(super) fn lan_ip() -> Option<String> {
    let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    socket.connect((Ipv4Addr::new(8, 8, 8, 8), 80)).ok()?;
    match socket.local_addr().ok()?.ip() {
        IpAddr::V4(ip) if !ip.is_loopback() => Some(ip.to_string()),
        _ => None,
    }
}
