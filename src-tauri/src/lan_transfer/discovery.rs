use crate::models::{LanDiscoveredDevice, LanTransferStatus};
use mdns_sd::{ResolvedService, ServiceDaemon, ServiceEvent, ServiceInfo};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const SERVICE_TYPE: &str = "_mftp._tcp.local.";

pub(super) fn run_responder(
    stop: Arc<AtomicBool>,
    id: String,
    device_name: String,
    host: String,
    port: u16,
) {
    let Ok(daemon) = ServiceDaemon::new() else {
        return;
    };
    let instance = sanitize_instance_name(&device_name, port);
    let host_name = format!("mftp-{}-{port}.local.", host.replace(['.', ':'], "-"));
    let url = format!("http://{host}:{port}");
    let properties = [
        ("id", id.as_str()),
        ("device_name", device_name.as_str()),
        ("ip", host.as_str()),
        ("url", url.as_str()),
    ];
    let Ok(info) = ServiceInfo::new(
        SERVICE_TYPE,
        &instance,
        &host_name,
        host.as_str(),
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

pub fn discover(status: LanTransferStatus) -> Vec<LanDiscoveredDevice> {
    let mut devices = HashMap::<String, LanDiscoveredDevice>::new();
    let Ok(daemon) = ServiceDaemon::new() else {
        return own_device(status).into_iter().collect();
    };
    if let Ok(receiver) = daemon.browse(SERVICE_TYPE) {
        let started = std::time::Instant::now();
        while started.elapsed() < Duration::from_millis(1200) {
            match receiver.recv_timeout(Duration::from_millis(180)) {
                Ok(ServiceEvent::ServiceResolved(info)) => {
                    if let Some(device) = device_from_service(&info) {
                        devices.insert(device.id.clone(), device);
                    }
                }
                Ok(_) => {}
                Err(_) => {}
            }
        }
    }
    let _ = daemon.shutdown();

    if let Some(device) = own_device(status) {
        devices.insert(device.id.clone(), device);
    }

    let mut devices = devices.into_values().collect::<Vec<_>>();
    devices.sort_by(|a, b| {
        b.online
            .cmp(&a.online)
            .then_with(|| a.device_name.cmp(&b.device_name))
            .then_with(|| a.ip.cmp(&b.ip))
    });
    devices
}

fn device_from_service(info: &ResolvedService) -> Option<LanDiscoveredDevice> {
    let port = info.get_port();
    let ip = info
        .get_property_val_str("ip")
        .map(str::to_string)
        .or_else(|| {
            info.get_addresses_v4()
                .into_iter()
                .next()
                .map(|ip| ip.to_string())
        })?;
    let id = info
        .get_property_val_str("id")
        .map(str::to_string)
        .unwrap_or_else(|| format!("{ip}:{port}"));
    let device_name = info
        .get_property_val_str("device_name")
        .map(str::to_string)
        .unwrap_or_else(|| info.get_fullname().to_string());
    let url = info
        .get_property_val_str("url")
        .map(str::to_string)
        .unwrap_or_else(|| format!("http://{ip}:{port}"));
    Some(LanDiscoveredDevice {
        id,
        device_name,
        ip,
        port,
        url,
        online: true,
        last_seen: now_ms(),
    })
}

fn own_device(status: LanTransferStatus) -> Option<LanDiscoveredDevice> {
    let (Some(ip), Some(port), Some(url)) = (status.host, status.port, status.url) else {
        return None;
    };
    Some(LanDiscoveredDevice {
        id: format!("{ip}:{port}"),
        device_name: "本机".to_string(),
        ip,
        port,
        url,
        online: status.running,
        last_seen: now_ms(),
    })
}

fn sanitize_instance_name(device_name: &str, port: u16) -> String {
    let name = device_name.trim();
    if name.is_empty() {
        return format!("MFTP {port}");
    }
    name.chars()
        .map(|ch| match ch {
            '\n' | '\r' | '\t' => ' ',
            _ => ch,
        })
        .collect()
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}
