#[cfg(any(target_os = "android", test))]
use serde::Deserialize;
use serde::Serialize;
use specta::Type;

/// Remote manifest, only decoded on Android; other targets never fetch it.
#[cfg(any(target_os = "android", test))]
#[derive(Debug, Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AndroidUpdateManifest {
    pub package_name: String,
    pub version: String,
    pub version_code: u64,
    pub url: String,
    pub size: u64,
    pub sha256: String,
    #[serde(default)]
    pub notes: String,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AndroidUpdateInfo {
    pub available: bool,
    pub current_version: String,
    pub current_version_code: u64,
    pub version: String,
    pub version_code: u64,
    pub url: String,
    pub size: u64,
    pub sha256: String,
    pub notes: String,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AndroidUpdateDownload {
    pub path: String,
    pub downloaded: u64,
    pub total: u64,
    pub version_code: u64,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AndroidUpdateInstall {
    pub outcome: String,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AndroidUpdateProgress {
    pub phase: String,
    pub downloaded: u64,
    pub total: u64,
}
