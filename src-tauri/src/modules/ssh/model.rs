use serde::{Deserialize, Serialize};
use specta::Type;

/// A remote directory entry returned by SFTP listing.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SftpEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    pub mtime: u64,
    pub mode: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SftpFileInfo {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    pub atime: u64,
    pub mtime: u64,
    #[serde(default)]
    pub created_at: Option<u64>,
    pub mode: u32,
    #[serde(default)]
    pub uid: Option<u32>,
    #[serde(default)]
    pub gid: Option<u32>,
}

/// CPU usage percentages computed over a ~1s measurement window.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SystemCpu {
    pub user: f64,
    pub nice: f64,
    pub system: f64,
    pub idle: f64,
    /// user + nice + system (i.e. everything but idle)
    pub used: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SystemLoad {
    pub load1: f64,
    pub load5: f64,
    pub load15: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SystemMemory {
    pub total: u64,
    pub used: u64,
    pub available: u64,
    pub free: u64,
    /// Buffers + page cache, as reported by `free`.
    pub cached: u64,
    pub swap_total: u64,
    pub swap_used: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SystemDisk {
    pub filesystem: String,
    pub mount: String,
    pub total: u64,
    pub used: u64,
    pub available: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SystemNetworkRate {
    pub name: String,
    pub rx_bytes_per_sec: u64,
    pub tx_bytes_per_sec: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SystemDiskIoRate {
    pub name: String,
    pub read_bytes_per_sec: u64,
    pub write_bytes_per_sec: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SystemProcess {
    pub pid: u32,
    pub user: String,
    pub cpu: f64,
    pub memory: f64,
    pub command: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SystemStats {
    /// Raw `uname -s` value (e.g. "Linux"). Monitor is Linux-only today.
    pub os: String,
    #[serde(default)]
    pub hostname: Option<String>,
    #[serde(default)]
    pub uptime_secs: Option<u64>,
    pub cpu: SystemCpu,
    /// Number of `cpuN` entries in /proc/stat; None when undetectable.
    #[serde(default)]
    pub cpu_cores: Option<u32>,
    #[serde(default)]
    pub load: Option<SystemLoad>,
    pub memory: SystemMemory,
    pub disks: Vec<SystemDisk>,
    pub network: Vec<SystemNetworkRate>,
    pub disk_io: Vec<SystemDiskIoRate>,
    pub top_processes: Vec<SystemProcess>,
}
