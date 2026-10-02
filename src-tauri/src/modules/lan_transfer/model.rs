use serde::{Deserialize, Serialize};
use specta::Type;

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
    // Older task snapshots lack this field; diagnostics are localized by the client.
    #[serde(default)]
    pub error: Option<crate::error::AppError>,
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
pub struct LanExportData {
    pub settings: LanTransferSettings,
    pub shared_dirs: Vec<LanSharedDir>,
    pub trusted_devices: Vec<LanTrustedDevice>,
}
