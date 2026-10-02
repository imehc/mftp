use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgress {
    pub id: String,
    pub phase: String,
    pub transferred: u64,
    pub total: Option<u64>,
    /// None: completion is driven by the command return value (SFTP).
    /// Some(true): the task is done; the frontend should mark it success
    /// (engine-managed tasks such as BT).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finished: Option<bool>,
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
    /// Full structured error for failed/canceled rows: versioned payload on
    /// new writes, compatibility-wrapped text on pre-column rows. Localized
    /// by the frontend through kind/code; `detail` keeps business metadata.
    #[serde(default)]
    pub error: Option<crate::error::AppError>,
}

/// A data section that can be exported; add a variant per exportable module.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ExportSection {
    Vault,
    Hosts,
    Todo,
    Lan,
    AiTranslations,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum AppDataModule {
    Vault,
    Hosts,
    Todo,
    Poetry,
    ActivityLogs,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AppDataUsage {
    pub vault_bytes: u64,
    pub hosts_bytes: u64,
    pub todo_bytes: u64,
    pub main_database_bytes: u64,
    pub poetry_database_bytes: u64,
    pub activity_logs_bytes: u64,
    pub bt_internal_bytes: u64,
    pub total_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AppDataClearResult {
    pub module: AppDataModule,
    pub records_deleted: u32,
    pub bytes_freed: u64,
    pub preserved: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AppDataResetResult {
    pub records_deleted: u32,
    pub bytes_freed: u64,
    pub preserved: Vec<String>,
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
