//! A long-lived mDNS browse shared by discovery requests.
//!
//! Starting a daemon and listening for a fixed window on every request made
//! each discovery cost the full window and missed peers between polls. The
//! browse now keeps running while requests keep coming and stops when idle.

use mdns_sd::{RecvTimeoutError, ResolvedService, ServiceDaemon, ServiceEvent};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

/// The browse stops after this long without a request and restarts on the next one.
const IDLE_STOP: Duration = Duration::from_secs(60);
/// Peers that vanish without a goodbye stay cached until their record TTL expires;
/// restarting the browse periodically bounds how long such stale entries survive.
const MAX_AGE: Duration = Duration::from_secs(600);

pub(crate) struct MdnsBrowser {
    service_type: &'static str,
    closed: AtomicBool,
    running: Mutex<Option<Running>>,
}

struct Shared {
    services: Mutex<HashMap<String, ResolvedService>>,
    last_used: Mutex<Instant>,
    stop: AtomicBool,
}

struct Running {
    shared: Arc<Shared>,
    started: Instant,
    worker: JoinHandle<()>,
}

impl MdnsBrowser {
    pub(crate) fn new(service_type: &'static str) -> Self {
        Self {
            service_type,
            closed: AtomicBool::new(false),
            running: Mutex::new(None),
        }
    }

    /// Currently resolved services. Right after a (re)start, waits up to
    /// `warmup` so the first request still sees peers that answer promptly.
    pub(crate) fn snapshot(
        &self,
        warmup: Duration,
        stopped: impl Fn() -> bool,
    ) -> Vec<ResolvedService> {
        let (shared, started) = {
            let mut running = self.running.lock();
            if self.closed.load(Ordering::SeqCst) {
                return Vec::new();
            }
            if running.as_ref().is_none_or(|running| {
                running.worker.is_finished() || running.started.elapsed() > MAX_AGE
            }) {
                if let Some(old) = running.take() {
                    old.shared.stop.store(true, Ordering::SeqCst);
                    let _ = old.worker.join();
                }
                *running = start(self.service_type);
            }
            let Some(running) = running.as_ref() else {
                return Vec::new();
            };
            *running.shared.last_used.lock() = Instant::now();
            (running.shared.clone(), running.started)
        };
        while started.elapsed() < warmup && !stopped() {
            thread::sleep(Duration::from_millis(50));
        }
        let services = shared.services.lock();
        services.values().cloned().collect()
    }

    /// Stops the browse for good; later snapshots return nothing.
    pub(crate) fn shutdown(&self) {
        let running = {
            let mut running = self.running.lock();
            self.closed.store(true, Ordering::SeqCst);
            running.take()
        };
        if let Some(running) = running {
            running.shared.stop.store(true, Ordering::SeqCst);
            let _ = running.worker.join();
        }
    }
}

impl Drop for MdnsBrowser {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn start(service_type: &'static str) -> Option<Running> {
    let daemon = ServiceDaemon::new().ok()?;
    let Ok(receiver) = daemon.browse(service_type) else {
        stop_daemon(&daemon);
        return None;
    };
    let shared = Arc::new(Shared {
        services: Mutex::new(HashMap::new()),
        last_used: Mutex::new(Instant::now()),
        stop: AtomicBool::new(false),
    });
    let worker_shared = shared.clone();
    let worker_daemon = daemon.clone();
    let worker = thread::Builder::new()
        .name("mdns-browse".into())
        .spawn(move || {
            while !worker_shared.stop.load(Ordering::SeqCst)
                && worker_shared.last_used.lock().elapsed() < IDLE_STOP
            {
                match receiver.recv_timeout(Duration::from_millis(200)) {
                    Ok(ServiceEvent::ServiceResolved(info)) => {
                        let name = info.get_fullname().to_string();
                        worker_shared.services.lock().insert(name, *info);
                    }
                    // Sent on goodbye packets and TTL expiry, so departed peers drop out.
                    Ok(ServiceEvent::ServiceRemoved(_, name)) => {
                        worker_shared.services.lock().remove(&name);
                    }
                    Ok(_) | Err(RecvTimeoutError::Timeout) => {}
                    Err(RecvTimeoutError::Disconnected) => break,
                }
            }
            stop_daemon(&worker_daemon);
        });
    match worker {
        Ok(worker) => Some(Running {
            shared,
            started: Instant::now(),
            worker,
        }),
        Err(_) => {
            stop_daemon(&daemon);
            None
        }
    }
}

fn stop_daemon(daemon: &ServiceDaemon) {
    // shutdown() only enqueues Exit; wait for the acknowledgement and retry
    // while the command queue is temporarily full.
    loop {
        match daemon.shutdown() {
            Ok(completed) => {
                let _ = completed.recv();
                return;
            }
            Err(mdns_sd::Error::DaemonShutdown) => return,
            Err(_) => thread::sleep(Duration::from_millis(10)),
        }
    }
}
