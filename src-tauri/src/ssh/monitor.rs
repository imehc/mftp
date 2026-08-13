use crate::models::{
    SystemCpu, SystemDisk, SystemDiskIoRate, SystemLoad, SystemMemory, SystemNetworkRate,
    SystemProcess, SystemStats,
};

/// Marker prefix separating the sections of the combined monitor script output.
const SECTION_MARKER: &str = "__MFTP_SEC__";
/// Top-N processes reported to the frontend.
const TOP_PROCESS_COUNT: usize = 20;
/// Minimum rate window (seconds) so a tiny delta can't blow up the division.
const MIN_SAMPLE_WINDOW_SECS: f64 = 0.3;
/// A cached sample older than this would make "current" rates an average over
/// the whole gap, so the next poll re-runs the warmup double snapshot instead.
const MAX_SAMPLE_AGE_SECS: f64 = 120.0;
const SECTOR_SIZE_BYTES: u64 = 512;
/// Cap for the single combined monitor command so a hung remote command can't
/// stall the whole monitor call (see `exec_monitor`).
const MONITOR_EXEC_TIMEOUT_MS: u32 = 10_000;

/// Previous poll's raw counters, kept per session so each refresh needs only
/// one snapshot: rates are computed against this cache instead of sleeping
/// between two snapshots inside every call.
#[derive(Clone)]
pub(crate) struct MonitorSample {
    stat: String,
    net_dev: String,
    diskstats: String,
    /// Remote /proc/uptime at snapshot time. Rate windows are computed on the
    /// remote clock so network jitter can't skew them.
    uptime_secs: Option<f64>,
    /// Local receive time; used for cache staleness and as a dt fallback.
    at: Instant,
}

fn script_section(script: &mut String, name: &str, cmd: &str) {
    script.push_str(&format!("echo '{SECTION_MARKER} {name}'; {cmd}\n"));
}

/// Build the combined monitor script: every metric in ONE remote exec instead
/// of one channel round-trip per command. Each section may fail independently
/// (`2>/dev/null`) and the trailing `true` keeps the overall exit code 0, so a
/// missing file degrades that metric instead of failing the whole poll.
/// `warmup` prepends a first counter snapshot plus a remote `sleep 1` for the
/// first poll of a session, when no cached sample exists yet.
fn monitor_script(warmup: bool) -> String {
    let mut script = String::new();
    if warmup {
        for (name, path) in [
            ("stat0", "/proc/stat"),
            ("net0", "/proc/net/dev"),
            ("diskio0", "/proc/diskstats"),
            ("uptime0", "/proc/uptime"),
        ] {
            script_section(&mut script, name, &format!("cat {path} 2>/dev/null"));
        }
        script.push_str("sleep 1\n");
    }
    script_section(&mut script, "uname", "uname -s 2>/dev/null");
    for (name, path) in [
        ("stat", "/proc/stat"),
        ("net", "/proc/net/dev"),
        ("diskio", "/proc/diskstats"),
        ("uptime", "/proc/uptime"),
        ("load", "/proc/loadavg"),
        ("mem", "/proc/meminfo"),
        ("host", "/proc/sys/kernel/hostname"),
    ] {
        script_section(&mut script, name, &format!("cat {path} 2>/dev/null"));
    }
    // `timeout` guards df against a stale network mount hanging the whole
    // script; fall back to plain df where coreutils timeout is missing.
    script_section(
        &mut script,
        "df",
        "if command -v timeout >/dev/null 2>&1; then timeout 5 df -Pk 2>/dev/null; else df -Pk 2>/dev/null; fi",
    );
    // head bounds the payload; TOP_PROCESS_COUNT is enforced again in Rust.
    script_section(
        &mut script,
        "ps",
        "ps -eo pid=,user=,%cpu=,%mem=,args= --sort=-%cpu 2>/dev/null | head -25",
    );
    script.push_str("true\n");
    script
}

/// Split combined script output on `__MFTP_SEC__ <name>` marker lines.
/// Anything before the first marker (e.g. shell rc noise) is ignored. A
/// marker only matches at the start of a line, so ps args can't fake one.
fn split_sections(output: &str) -> std::collections::HashMap<&str, String> {
    let mut sections: std::collections::HashMap<&str, String> = std::collections::HashMap::new();
    let mut current: Option<&str> = None;
    for line in output.lines() {
        if let Some(rest) = line.strip_prefix(SECTION_MARKER) {
            let name = rest.trim();
            sections.entry(name).or_default();
            current = Some(name);
            continue;
        }
        if let Some(name) = current {
            let body = sections.entry(name).or_default();
            body.push_str(line);
            body.push('\n');
        }
    }
    sections
}

impl Manager {
    /// Run the combined monitor script with a bounded read timeout. A hung
    /// remote command must never idle the monitor forever, so the session
    /// timeout is narrowed for the duration of the command and restored
    /// afterwards for other callers. On any failure the cached SFTP
    /// connection is dropped so a timed-out session can't poison the next
    /// sample.
    fn exec_monitor(&self, session_id: &str, script: &str) -> AppResult<String> {
        let conn_arc = self.sftp_conn(session_id)?;
        let result = {
            let conn = conn_arc.lock();
            conn.session.set_blocking(true);
            let previous_timeout = conn.session.timeout();
            conn.session.set_timeout(MONITOR_EXEC_TIMEOUT_MS);
            let result: AppResult<String> = (|| {
                let mut channel = conn.session.channel_session()?;
                channel.exec(script)?;
                let mut stdout = String::new();
                channel.read_to_string(&mut stdout)?;
                channel.wait_close()?;
                let code = channel.exit_status()?;
                if code != 0 {
                    return Err(AppError(format!(
                        "远端命令失败 (exit {code}): {}",
                        stdout.trim()
                    )));
                }
                Ok(stdout)
            })();
            conn.session.set_timeout(previous_timeout);
            result
        };
        if result.is_err() {
            self.remove_sftp_conn_if_current(session_id, &conn_arc);
        }
        result
    }

    /// Gather remote system stats in a single remote exec. Only Linux is
    /// supported (metrics come from /proc); other OSes get a clear error
    /// instead of garbage numbers.
    pub fn system_stats(&self, session_id: &str) -> AppResult<SystemStats> {
        // Cache is read (not taken), so a transient exec failure keeps the
        // previous sample for the next attempt.
        let cached = self.monitor.lock().get(session_id).cloned();
        let warmup = !cached
            .as_ref()
            .is_some_and(|sample| sample.at.elapsed().as_secs_f64() < MAX_SAMPLE_AGE_SECS);
        let output = self.exec_monitor(session_id, &monitor_script(warmup))?;
        let sections = split_sections(&output);
        let text = |name: &str| sections.get(name).map(String::as_str).unwrap_or("");

        let os = text("uname").trim().to_string();
        if os.is_empty() {
            return Err(AppError("无法识别远端系统".into()));
        }
        if !os.eq_ignore_ascii_case("linux") {
            return Err(AppError(format!("系统监控暂不支持 {os}，仅支持 Linux")));
        }

        let current = MonitorSample {
            stat: text("stat").to_string(),
            net_dev: text("net").to_string(),
            diskstats: text("diskio").to_string(),
            uptime_secs: parse_uptime_secs(text("uptime")),
            at: Instant::now(),
        };
        let prev = match (warmup, cached) {
            (false, Some(sample)) => sample,
            _ => MonitorSample {
                stat: text("stat0").to_string(),
                net_dev: text("net0").to_string(),
                diskstats: text("diskio0").to_string(),
                uptime_secs: parse_uptime_secs(text("uptime0")),
                at: current.at,
            },
        };
        // dt on the remote clock (uptime survives NTP steps and network
        // jitter). A remote reboot makes it go backwards -> fall back, and
        // counter resets zero out via saturating_sub in the parsers.
        let dt = match (prev.uptime_secs, current.uptime_secs) {
            (Some(before), Some(after)) if after > before => after - before,
            // The warmup window is the remote `sleep 1`.
            _ if warmup => 1.0,
            _ => current.at.saturating_duration_since(prev.at).as_secs_f64(),
        }
        .max(MIN_SAMPLE_WINDOW_SECS);

        let cpu = parse_cpu(&prev.stat, &current.stat);
        let cpu_cores = count_cpu_cores(&current.stat);
        let load = parse_loadavg(text("load"));
        let memory = parse_meminfo(text("mem"));
        let uptime_secs = current.uptime_secs.map(|value| value as u64);
        let hostname = Some(text("host").trim().to_string()).filter(|value| !value.is_empty());
        let disks = parse_df(text("df"));
        let network = parse_net_dev(&prev.net_dev, &current.net_dev, dt);
        let disk_io = parse_diskstats(&prev.diskstats, &current.diskstats, dt);
        let top_processes = parse_ps(text("ps"));

        self.monitor
            .lock()
            .insert(session_id.to_string(), current);

        Ok(SystemStats {
            os,
            hostname,
            uptime_secs,
            cpu,
            cpu_cores,
            load,
            memory,
            disks,
            network,
            disk_io,
            top_processes,
        })
    }

    pub fn clear_monitor_cache(&self, session_id: &str) {
        self.monitor.lock().remove(session_id);
    }
}

/// Compute CPU percentages from two /proc/stat samples ("cpu " aggregate
/// line). Deltas are measured in jiffies, so the wall-clock window is
/// irrelevant: each category is a fraction of the total delta.
fn parse_cpu(before: &str, after: &str) -> SystemCpu {
    let idle_default = SystemCpu {
        user: 0.0,
        nice: 0.0,
        system: 0.0,
        idle: 100.0,
        used: 0.0,
    };
    let a = parse_stat_cpu_fields(before);
    let b = parse_stat_cpu_fields(after);
    // A missing or truncated snapshot (failed cat) must degrade, not panic:
    // indexes up to [4] (iowait) are used below.
    if a.len() < 5 || b.len() < 5 {
        return idle_default;
    }
    let total = b
        .iter()
        .zip(&a)
        .map(|(current, previous)| current.saturating_sub(*previous))
        .sum::<u64>();
    if total == 0 {
        return idle_default;
    }
    let total_f = total as f64;
    // Layout after trimming the "cpu " prefix:
    // [user, nice, system, idle, iowait, irq, softirq, steal, guest, guest_nice]
    let user = b[0].saturating_sub(a[0]) as f64 / total_f * 100.0;
    let nice = b[1].saturating_sub(a[1]) as f64 / total_f * 100.0;
    let system = b[2].saturating_sub(a[2]) as f64 / total_f * 100.0;
    // Idle time includes iowait, matching how `top` reports idle.
    let idle = ((b[3].saturating_sub(a[3]) + b[4].saturating_sub(a[4])) as f64) / total_f * 100.0;
    SystemCpu {
        user,
        nice,
        system,
        idle,
        used: user + nice + system,
    }
}

fn parse_stat_cpu_fields(sample: &str) -> Vec<u64> {
    sample
        .lines()
        .find(|line| line.starts_with("cpu "))
        .map(|line| {
            line.split_whitespace()
                .skip(1)
                .map(parse_u64)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

/// Count `cpuN` lines in /proc/stat (the aggregate "cpu " line has no digit).
fn count_cpu_cores(stat: &str) -> Option<u32> {
    let count = stat
        .lines()
        .filter(|line| {
            line.strip_prefix("cpu")
                .and_then(|rest| rest.chars().next())
                .is_some_and(|ch| ch.is_ascii_digit())
        })
        .count();
    (count > 0).then_some(count as u32)
}

fn parse_u64(value: &str) -> u64 {
    value.trim().parse().unwrap_or(0)
}

fn parse_f64(value: &str) -> f64 {
    value.trim().parse().unwrap_or(0.0)
}

fn parse_loadavg(sample: &str) -> Option<SystemLoad> {
    let values: Vec<f64> = sample.split_whitespace().take(3).map(parse_f64).collect();
    if values.len() < 3 {
        return None;
    }
    Some(SystemLoad {
        load1: values[0],
        load5: values[1],
        load15: values[2],
    })
}

fn parse_uptime_secs(sample: &str) -> Option<f64> {
    sample.split_whitespace().next()?.parse().ok()
}

fn parse_meminfo(sample: &str) -> SystemMemory {
    let mut fields: std::collections::HashMap<&str, u64> = std::collections::HashMap::new();
    for line in sample.lines() {
        let mut parts = line.splitn(2, ':');
        let (Some(key), Some(raw)) = (parts.next(), parts.next()) else {
            continue;
        };
        let kb = raw
            .split_whitespace()
            .next()
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(0);
        fields.insert(key.trim(), kb.saturating_mul(1024));
    }
    let total = fields.get("MemTotal").copied().unwrap_or(0);
    let available = fields.get("MemAvailable").copied().unwrap_or(0);
    let free = fields.get("MemFree").copied().unwrap_or(0);
    // Same cached grouping as `free`: Buffers + Cached.
    let cached = fields
        .get("Buffers")
        .copied()
        .unwrap_or(0)
        .saturating_add(fields.get("Cached").copied().unwrap_or(0));
    let swap_total = fields.get("SwapTotal").copied().unwrap_or(0);
    let swap_free = fields.get("SwapFree").copied().unwrap_or(0);
    SystemMemory {
        total,
        used: total.saturating_sub(available),
        available,
        free,
        cached,
        swap_total,
        swap_used: swap_total.saturating_sub(swap_free),
    }
}

/// Parse `df -Pk` (POSIX, KiB blocks), keeping only real or overlay
/// filesystems and dropping pseudo filesystems like tmpfs/udev.
fn parse_df(sample: &str) -> Vec<SystemDisk> {
    let mut disks = Vec::new();
    for line in sample.lines() {
        if line.is_empty() || line.starts_with("Filesystem") {
            continue;
        }
        let mut fields = line.split_whitespace();
        let Some(filesystem) = fields.next() else {
            continue;
        };
        if !filesystem.starts_with('/') && !filesystem.starts_with("overlay") {
            continue;
        }
        let blocks = fields.next().map(parse_u64).unwrap_or(0);
        let used = fields.next().map(parse_u64).unwrap_or(0);
        let available = fields.next().map(parse_u64).unwrap_or(0);
        let _capacity = fields.next();
        let mount: Vec<&str> = fields.collect();
        if mount.is_empty() {
            continue;
        }
        disks.push(SystemDisk {
            filesystem: filesystem.to_string(),
            mount: mount.join(" "),
            total: blocks.saturating_mul(1024),
            used: used.saturating_mul(1024),
            available: available.saturating_mul(1024),
        });
    }
    disks
}

/// Parse two /proc/net/dev snapshots into per-interface transfer rates.
fn parse_net_dev(before: &str, after: &str, dt: f64) -> Vec<SystemNetworkRate> {
    let a = parse_net_map(before);
    let b = parse_net_map(after);
    let mut rates = Vec::new();
    for (name, previous) in a {
        if name == "lo" {
            continue;
        }
        let Some(current) = b.get(&name) else {
            continue;
        };
        rates.push(SystemNetworkRate {
            name,
            rx_bytes_per_sec: (current.0.saturating_sub(previous.0) as f64 / dt) as u64,
            tx_bytes_per_sec: (current.1.saturating_sub(previous.1) as f64 / dt) as u64,
        });
    }
    rates.sort_by(|left, right| right.rx_bytes_per_sec.cmp(&left.rx_bytes_per_sec));
    rates
}

fn parse_net_map(sample: &str) -> std::collections::HashMap<String, (u64, u64)> {
    let mut map = std::collections::HashMap::new();
    for line in sample.lines() {
        // "eth0: 123 456 ..."
        let Some((name, values)) = line.split_once(':') else {
            continue;
        };
        let fields: Vec<u64> = values.split_whitespace().map(parse_u64).collect();
        if fields.len() >= 9 {
            map.insert(name.trim().to_string(), (fields[0], fields[8]));
        }
    }
    map
}

/// Parse two /proc/diskstats snapshots into per-device read/write rates.
/// Sectors are 512 bytes each on stock kernels.
fn parse_diskstats(before: &str, after: &str, dt: f64) -> Vec<SystemDiskIoRate> {
    let a = parse_disk_map(before);
    let b = parse_disk_map(after);
    let mut rates = Vec::new();
    for (name, previous) in a {
        let Some(current) = b.get(&name) else {
            continue;
        };
        rates.push(SystemDiskIoRate {
            name,
            read_bytes_per_sec: (current.0.saturating_sub(previous.0) as f64 / dt) as u64
                * SECTOR_SIZE_BYTES,
            write_bytes_per_sec: (current.1.saturating_sub(previous.1) as f64 / dt) as u64
                * SECTOR_SIZE_BYTES,
        });
    }
    rates.sort_by(|left, right| {
        right
            .read_bytes_per_sec
            .saturating_add(right.write_bytes_per_sec)
            .cmp(&left.read_bytes_per_sec.saturating_add(left.write_bytes_per_sec))
    });
    rates
}

fn parse_disk_map(sample: &str) -> std::collections::HashMap<String, (u64, u64)> {
    let mut map = std::collections::HashMap::new();
    for line in sample.lines() {
        let fields: Vec<&str> = line.split_whitespace().collect();
        if fields.len() < 10 {
            continue;
        }
        let name = fields[2];
        // Skip synthetic/pseudo devices to keep the list readable.
        if name.starts_with("loop")
            || name.starts_with("ram")
            || name.starts_with("dm-")
            || name.starts_with("zram")
            || name.starts_with("fd")
        {
            continue;
        }
        // Format: major minor name reads merged rsectors rtime writes
        // merged wsectors wtime ... -> index 5 = read sectors, 9 = write sectors.
        let read_sectors = parse_u64(fields[5]);
        let write_sectors = parse_u64(fields[9]);
        map.insert(name.to_string(), (read_sectors, write_sectors));
    }
    map
}

/// Parse `ps -eo pid=,user=,%cpu=,%mem=,args=` sorted by CPU desc. Field
/// padding means columns are separated by runs of whitespace.
fn parse_ps(sample: &str) -> Vec<SystemProcess> {
    let mut processes = Vec::new();
    for line in sample.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with("PID") {
            continue;
        }
        let fields: Vec<&str> = trimmed.split_whitespace().collect();
        if fields.len() < 4 {
            continue;
        }
        let Ok(pid) = fields[0].parse::<u32>() else {
            continue;
        };
        processes.push(SystemProcess {
            pid,
            user: fields[1].to_string(),
            cpu: parse_f64(fields[2]),
            memory: parse_f64(fields[3]),
            command: fields[4..].join(" "),
        });
    }
    processes.sort_by(|left, right| right.cpu.total_cmp(&left.cpu));
    processes.truncate(TOP_PROCESS_COUNT);
    processes
}

#[cfg(test)]
mod monitor_tests {
    use super::*;

    #[test]
    fn split_sections_extracts_named_bodies() {
        let output = "login noise\n__MFTP_SEC__ uname\nLinux\n__MFTP_SEC__ load\n0.5 0.4 0.3 1/200 999\n";
        let sections = split_sections(output);
        assert_eq!(sections.get("uname").map(String::as_str), Some("Linux\n"));
        assert_eq!(
            sections.get("load").map(String::as_str),
            Some("0.5 0.4 0.3 1/200 999\n")
        );
        assert!(!sections.contains_key("noise"));
    }

    #[test]
    fn split_sections_keeps_empty_section() {
        let sections = split_sections("__MFTP_SEC__ mem\n__MFTP_SEC__ host\nbox\n");
        assert_eq!(sections.get("mem").map(String::as_str), Some(""));
        assert_eq!(sections.get("host").map(String::as_str), Some("box\n"));
    }

    #[test]
    fn parse_cpu_degrades_on_truncated_input() {
        let cpu = parse_cpu("", "cpu 1 2 3 4 5 6 7 8 9 10");
        assert_eq!(cpu.idle, 100.0);
        assert_eq!(cpu.used, 0.0);
    }

    #[test]
    fn count_cpu_cores_ignores_aggregate_line() {
        let stat = "cpu 1 2 3 4 5\ncpu0 1 2 3 4 5\ncpu1 1 2 3 4 5\nintr 0\n";
        assert_eq!(count_cpu_cores(stat), Some(2));
        assert_eq!(count_cpu_cores("intr 0\n"), None);
    }

    #[test]
    fn monitor_script_warmup_has_double_snapshot() {
        let warm = monitor_script(true);
        assert!(warm.contains("stat0"));
        assert!(warm.contains("sleep 1"));
        assert!(warm.trim_end().ends_with("true"));
        let normal = monitor_script(false);
        assert!(!normal.contains("stat0"));
        assert!(!normal.contains("sleep"));
    }
}
