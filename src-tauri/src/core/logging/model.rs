use crate::{core::diagnostics::DiagnosticOperation, error::AppError, models::ActivityLog};
use serde::{Deserialize, Serialize};
use specta::Type;

pub(super) const SEGMENT_BYTES: u64 = 8 * 1024 * 1024;
pub(super) const TOTAL_BYTES: u64 = 100 * 1024 * 1024;
pub(super) const RETENTION_MS: i64 = 7 * 86_400_000;
pub(super) const EVENT_BYTES: usize = 1024 * 1024;
pub(super) const QUEUE_BYTES: usize = 8 * 1024 * 1024;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Event {
    pub schema_version: u32,
    pub event_id: String,
    pub run_id: String,
    pub sequence: String,
    pub timestamp: i64,
    pub generation: u64,
    #[serde(flatten)]
    pub payload: Payload,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(super) enum Payload {
    Operation {
        record: ActivityLog,
    },
    Protocol {
        operation_id: String,
        changes: Vec<super::delta::Change>,
    },
    Runtime {
        module: String,
        #[serde(default = "default_runtime_action")]
        action: String,
        #[serde(default = "default_runtime_result")]
        result: String,
        message: String,
        #[serde(default)]
        operation_id: Option<String>,
    },
    Gap {
        discarded: u64,
    },
}

fn default_runtime_action() -> String {
    "runtime".into()
}

fn default_runtime_result() -> String {
    "failed".into()
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LogHealth {
    pub error: Option<AppError>,
    pub discarded: u32,
    pub malformed: u32,
    pub pending: u32,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub id: String,
    pub timestamp: f64,
    pub summary: Option<ActivityLog>,
    pub operation: Option<DiagnosticOperation>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LogPage {
    pub entries: Vec<LogEntry>,
    pub next: Option<String>,
    pub health: LogHealth,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LogFile {
    pub id: String,
    pub bytes: f64,
    pub modified_at: f64,
    pub protected: bool,
}
