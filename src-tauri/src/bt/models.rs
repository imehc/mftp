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
    pub dest_dir: String,
    /// 'download'; 'preview' (cache mode) added in P2.
    pub mode: String,
    pub pinned: bool,
    pub status: BtTaskStatus,
    pub package_mode: BtPackageMode,
    pub cache_available: bool,
    pub error: Option<String>,
    pub total: Option<u64>,
    pub progress: Option<u64>,
    pub finished: bool,
    pub peers_live: u32,
    /// Live engine state; None while the engine is down or the handle has not
    /// been restored yet. The transfer panel only adopts a task once this says
    /// it is actually downloading, so history stays out of it.
    pub state: Option<BtTaskState>,
    /// Selected files of a preview task, so its row can offer open / save-as.
    /// Empty for plain downloads and while the engine has no handle.
    pub files: Vec<BtFileMeta>,
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

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BtCacheStats {
    pub used_bytes: u64,
    pub quota_bytes: u64,
    /// Task count inside the cache pool (mode='preview').
    pub items: usize,
}

/// One cache-pool entry, for the manageable cache list.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BtCacheItem {
    pub info_hash: String,
    pub label: String,
    /// On-disk size of this entry's cache directory, i.e. how much of the file
    /// is cached so far.
    pub size_bytes: u64,
    /// Total size of the task's selected files; None while the engine is down
    /// or metadata has not arrived.
    pub total_bytes: Option<u64>,
    pub last_access: i64,
    /// Pinned (save-to-local in flight) or currently streaming: exempt from
    /// eviction, and deleting would break the operation in progress.
    pub pinned: bool,
    pub streaming: bool,
    /// The task's selected files, so the cache list can offer open/save-as.
    /// Empty while the engine has no handle for this task.
    pub files: Vec<BtFileMeta>,
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

/// Live stats for one task; polled by the preview page footer.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BtTaskStats {
    pub info_hash: String,
    pub state: BtTaskState,
    pub progress: u64,
    pub total: u64,
    pub down_bps: u64,
    pub up_bps: u64,
    pub peers_live: u32,
    pub peers_queued: u32,
}

/// Payload of bt://task-event. The kind covers save, package, and removal
/// lifecycle notifications; detailed progress stays on TransferProgress.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BtTaskEvent {
    pub info_hash: String,
    pub kind: String,
}
