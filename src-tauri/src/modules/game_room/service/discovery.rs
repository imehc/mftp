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
use std::io::BufReader;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream, UdpSocket};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use super::super::GameRoomSummary;

use super::framing::{encode, read_message, write_frame, HANDSHAKE_FRAME_LIMIT};
use super::{runtime::StopSignal, wire::WireMsg};
use crate::error::{AppError, AppResult, CustomErrorCode};

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
pub(super) fn discover_rooms(
    game_id: &str,
    exclude_room: Option<&str>,
    stop: &StopSignal,
) -> AppResult<Vec<GameRoomSummary>> {
    thread::scope(|scope| {
        let sweep = thread::Builder::new()
            .name("room-sweep".into())
            .spawn_scoped(scope, || sweep_lan(game_id, stop))?;
        let mut rooms = HashMap::<String, GameRoomSummary>::new();
        if let Ok(daemon) = ServiceDaemon::new() {
            let _shutdown = MdnsShutdown(&daemon);
            if let Ok(receiver) = daemon.browse(SERVICE_TYPE) {
                let started = Instant::now();
                while started.elapsed() < DISCOVER_WINDOW && !stop.is_stopped() {
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
                                    room_name: present(prop("name")),
                                    host_name: present(prop("host")),
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
        }
        let swept = sweep
            .join()
            .map_err(|_| AppError::external("task:panicked", "Room discovery worker panicked"))??;
        if stop.is_stopped() {
            return Err(AppError::custom(CustomErrorCode::AppShuttingDown));
        }
        for room in swept {
            rooms.entry(room.room_id.clone()).or_insert(room);
        }
        if let Some(own) = exclude_room {
            rooms.remove(own);
        }
        let mut rooms = rooms.into_values().collect::<Vec<_>>();
        rooms.sort_by(|a, b| a.room_name.cmp(&b.room_name).then_with(|| a.ip.cmp(&b.ip)));
        Ok(rooms)
    })
}

/// Empty TXT/frame values carry no displayable name; treat them as absent so
/// the frontend localizes the placeholder instead of the backend inventing copy.
fn present(value: Option<String>) -> Option<String> {
    value.filter(|value| !value.trim().is_empty())
}

/// Advertise the room over mDNS until `stop` is set.
#[allow(clippy::too_many_arguments)]
pub(super) fn run_responder(
    stop: Arc<StopSignal>,
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
    let _shutdown = MdnsShutdown(&daemon);
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
        return;
    };
    let fullname = info.get_fullname().to_string();
    if daemon.register(info).is_err() {
        return;
    }
    while !stop.wait(Duration::from_millis(300)) {}
    let _ = daemon.unregister(&fullname);
}

/// Probe one address for a room card. Plain unicast TCP — needs no
/// permissions anywhere, works wherever direct connect works.
#[cfg(test)]
pub(super) fn probe_room(addr: SocketAddr) -> Option<GameRoomSummary> {
    probe_room_until_stop(addr, &StopSignal::default())
}

pub(super) fn probe_room_until_stop(
    addr: SocketAddr,
    stop: &StopSignal,
) -> Option<GameRoomSummary> {
    if stop.is_stopped() {
        return None;
    }
    let mut stream = TcpStream::connect_timeout(&addr, SWEEP_CONNECT_TIMEOUT).ok()?;
    let _ = stream.set_nodelay(true);
    let frame = encode(&WireMsg::Probe).ok()?;
    write_frame(&mut stream, &frame, Instant::now() + PROBE_IO_TIMEOUT).ok()?;
    let mut reader = BufReader::new(stream);
    match read_message(&mut reader, stop, HANDSHAKE_FRAME_LIMIT, PROBE_IO_TIMEOUT).ok()? {
        WireMsg::RoomInfo {
            room_id,
            game_id,
            room_name,
            host_name,
            has_code,
        } => Some(GameRoomSummary {
            room_id,
            game_id,
            room_name: present(Some(room_name)),
            host_name: present(Some(host_name)),
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
fn sweep_lan(game_id: &str, stop: &StopSignal) -> AppResult<Vec<GameRoomSummary>> {
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
        return Ok(Vec::new());
    }
    let targets = Arc::new(Mutex::new(targets));
    let found: Arc<Mutex<Vec<GameRoomSummary>>> = Arc::new(Mutex::new(Vec::new()));
    // Scoped workers cannot outlive the discovery lease, even on spawn failure
    // or panic. Shutdown stops dequeuing targets; individual probes are bounded.
    thread::scope(|scope| -> AppResult<()> {
        let mut workers = Vec::new();
        for _ in 0..SWEEP_THREADS {
            let targets = targets.clone();
            let found = found.clone();
            workers.push(
                thread::Builder::new()
                    .name("room-probe".into())
                    .spawn_scoped(scope, move || {
                        while !stop.is_stopped() {
                            let Some(addr) = targets.lock().pop() else {
                                return;
                            };
                            if let Some(room) = probe_room_until_stop(addr, stop) {
                                if room.game_id == game_id {
                                    found.lock().push(room);
                                }
                            }
                        }
                    })?,
            );
        }
        for worker in workers {
            worker
                .join()
                .map_err(|_| AppError::external("task:panicked", "Room probe worker panicked"))?;
        }
        Ok(())
    })?;
    let rooms = found.lock().clone();
    Ok(rooms)
}

/// The library has no join handle. Await its documented shutdown acknowledgement
/// after cleanup instead of treating a queued shutdown request as completion.
struct MdnsShutdown<'a>(&'a ServiceDaemon);
impl Drop for MdnsShutdown<'_> {
    fn drop(&mut self) {
        loop {
            match self.0.shutdown() {
                Ok(stopped) => {
                    let _ = stopped.recv();
                    return;
                }
                Err(mdns_sd::Error::DaemonShutdown) => return,
                Err(_) => thread::sleep(Duration::from_millis(50)),
            }
        }
    }
}

pub(super) fn lan_ip() -> Option<String> {
    let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    socket.connect((Ipv4Addr::new(8, 8, 8, 8), 80)).ok()?;
    match socket.local_addr().ok()?.ip() {
        IpAddr::V4(ip) if !ip.is_loopback() => Some(ip.to_string()),
        _ => None,
    }
}
