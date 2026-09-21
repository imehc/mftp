//! IPC DTOs of the bt module. Field changes flow into bindings.ts
//! automatically; never hand-write the corresponding frontend types.

use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BtFileMeta {
    pub index: usize,
    pub path: String,
    pub len: u64,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BtProbeResult {
    pub info_hash: String,
    pub name: String,
    pub files: Vec<BtFileMeta>,
    pub total_len: u64,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BtTaskInfo {
    pub info_hash: String,
    pub label: String,
    /// Application-private directory that owns the downloaded pieces.
    pub download_dir: String,
    /// Completed file/archive path inside the application-private directory.
    pub output_path: Option<String>,
    /// Optional user-directory copy created by an explicit export action.
    pub export_path: Option<String>,
    pub exported: bool,
    pub status: BtTaskStatus,
    pub package_mode: BtPackageMode,
    /// Selected source file used by the progressive preview endpoint.
    pub file_index: Option<usize>,
    pub file_name: Option<String>,
    pub error: Option<String>,
    pub total: Option<u64>,
    pub progress: Option<u64>,
    pub finished: bool,
    pub peers_live: u32,
    /// Live engine state; None while the engine is down or the handle has not
    /// been restored yet. The transfer panel only adopts a task once this says
    /// it is actually downloading, so history stays out of it.
    pub state: Option<BtTaskState>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BtPlayability {
    pub info_hash: String,
    pub file_index: usize,
    pub file_name: String,
    pub supported: bool,
    pub total_bytes: u64,
    pub contiguous_bytes: u64,
    pub minimum_bytes: u64,
    pub ready: bool,
    pub loading: bool,
    pub reason: Option<String>,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
pub enum BtTaskStatus {
    Active,
    Packaging,
    Completed,
    Cancelled,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
pub enum BtPackageMode {
    Direct,
    Archive,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Type)]
pub enum BtControlAction {
    Pause,
    Resume,
    Cancel,
    Remove,
}

/// Per-peer details (IP masked).
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BtPeerInfo {
    pub addr: String,
    pub client_name: Option<String>,
    pub fetched_bytes: u64,
    pub uploaded_bytes: u64,
    pub state: String,
}

/// Shared DHT diagnostics for the current platform-local BT session.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BtDhtStatus {
    pub enabled: bool,
    pub ipv4_nodes: usize,
    pub ipv6_nodes: usize,
    pub outstanding_requests: usize,
    pub state: BtDhtState,
}

#[derive(Debug, Clone, Copy, Serialize, Type)]
pub enum BtDhtState {
    Disabled,
    NotEstablished,
    Bootstrapping,
    Ready,
}

/// Engine-side task state. Kept as an enum rather than a display string so
/// the frontend owns the wording (i18n).
#[derive(Debug, Clone, Copy, Serialize, Type)]
pub enum BtTaskState {
    Initializing,
    Downloading,
    Seeding,
    Paused,
    Error,
}

/// Payload of bt://task-event. The kind covers save, package, and removal
/// lifecycle notifications; detailed progress stays on TransferProgress.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BtTaskEvent {
    pub info_hash: String,
    pub kind: String,
}
