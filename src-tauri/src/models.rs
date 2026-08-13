use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum AuthType {
    Password,
    Key,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Host {
    pub id: String,
    pub label: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: AuthType,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub key_id: Option<String>,
    /// Directory to open first in SFTP; falls back to home then "/" if missing.
    #[serde(default)]
    pub default_path: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Payload for creating/updating a host (id/timestamps managed by backend).
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HostInput {
    pub label: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: AuthType,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub key_id: Option<String>,
    #[serde(default)]
    pub default_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SshKey {
    pub id: String,
    pub label: String,
    pub filename: String,
    pub has_passphrase: bool,
    pub created_at: i64,
}

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

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgress {
    pub id: String,
    pub phase: String,
    pub transferred: u64,
    pub total: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LanTransferSettings {
    pub device_name: String,
    pub port: u16,
    pub bind_host: String,
    pub download_dir: String,
    pub auto_start: bool,
    pub security_mode: String,
    pub default_permission: String,
    pub max_concurrent_transfers: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LanTransferStatus {
    pub running: bool,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub url: Option<String>,
    pub online_connections: usize,
    pub auth_mode: String,
    #[serde(default)]
    pub confirmation_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LanConnectedDevice {
    pub id: String,
    pub ip: String,
    pub device_name: String,
    pub permission: String,
    pub connected_at: i64,
    pub last_seen: i64,
    pub current_operation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LanAuthRequest {
    pub id: String,
    pub ip: String,
    pub device_name: String,
    pub access_type: String,
    pub requested_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LanNetworkAddress {
    pub interface_name: String,
    pub ip: String,
    pub recommended: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LanDiscoveredDevice {
    pub id: String,
    pub device_name: String,
    pub ip: String,
    pub port: u16,
    pub url: String,
    pub online: bool,
    pub last_seen: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LanTransferTask {
    pub id: String,
    pub direction: String,
    pub file_name: String,
    pub ip: String,
    pub status: String,
    pub transferred: u64,
    pub total: u64,
    pub started_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LanSharedDir {
    pub id: String,
    pub name: String,
    pub path: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LanSharedDirInput {
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LanTrustedDevice {
    pub id: String,
    pub label: String,
    pub ip: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LanTrustedDeviceInput {
    pub label: String,
    pub ip: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ActivityLog {
    pub id: String,
    pub created_at: i64,
    pub source: String,
    pub ip: String,
    pub request_type: String,
    pub result: String,
    #[serde(default)]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GameRoomStatus {
    /// "idle" | "hosting" | "joined"
    pub phase: String,
    pub room_id: Option<String>,
    pub game_id: Option<String>,
    pub room_name: Option<String>,
    pub host: Option<String>,
    pub port: Option<u16>,
    /// 0 = host (first seat), 1 = guest.
    pub seat: Option<u8>,
    pub player_name: Option<String>,
    pub peer_name: Option<String>,
    pub has_code: bool,
    /// Only present for the host, so the UI can show the code to share.
    pub code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GameRoomSummary {
    pub room_id: String,
    pub game_id: String,
    pub room_name: String,
    pub host_name: String,
    pub ip: String,
    pub port: u16,
    pub has_code: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct VaultEntry {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Payload for creating/updating a vault entry (id/timestamps managed by backend).
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct VaultEntryInput {
    pub title: String,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
}

/// A data section that can be exported; add a variant per exportable module.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ExportSection {
    Vault,
    Hosts,
}

/// How imported records are applied to existing data.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ImportMode {
    /// Clear the section first, then insert everything from the file.
    Overwrite,
    /// Update records with matching ids, insert the rest.
    Merge,
    /// Insert everything as new records with fresh ids.
    Append,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub encrypted: bool,
    /// Empty for encrypted files until they are decrypted during import.
    pub sections: Vec<ExportSection>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ImportSectionReport {
    pub section: ExportSection,
    pub inserted: u32,
    pub updated: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub sections: Vec<ImportSectionReport>,
}

// ---- SSH system monitor ----

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
