use crate::error::AppError;
use serde::Serialize;
use specta::Type;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum DiagnosticStatus {
    Running,
    Passed,
    Unverified,
    Failed,
    Interrupted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum DiagnosticPhase {
    Preparing,
    Sending,
    Receiving,
    Executing,
    Finished,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum DiagnosticBodyEnd {
    Receiving,
    Complete,
    ProtocolEnd,
    Interrupted,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticText {
    pub text: String,
    pub encoding: String,
    pub received_bytes: f64,
    pub captured_bytes: u32,
    pub redacted: bool,
    pub truncated: bool,
    pub end: DiagnosticBodyEnd,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticHeader {
    pub name: String,
    pub value: String,
    pub encoding: String,
    pub redacted: bool,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DiagnosticDetail {
    HttpRequest {
        method: String,
        url: String,
        headers: Vec<DiagnosticHeader>,
        headers_truncated: bool,
        body: DiagnosticText,
    },
    HttpResponse {
        status: u16,
        headers: Vec<DiagnosticHeader>,
        headers_truncated: bool,
        body: DiagnosticText,
    },
    TransportError {
        body: DiagnosticText,
    },
    Command {
        command: DiagnosticText,
        stdout: DiagnosticText,
        stderr: DiagnosticText,
        stdout_captured: bool,
        exit_status: Option<i32>,
        exit_signal: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticProgress {
    pub phase: String,
    pub completed: f64,
    pub total: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticOperation {
    pub id: String,
    pub source: String,
    pub action: String,
    pub target: String,
    pub correlation_id: Option<String>,
    pub trace: Option<DiagnosticText>,
    pub progress: Option<DiagnosticProgress>,
    pub discarded_details: u32,
    pub metadata_truncated: bool,
    pub redacted: bool,
    pub started_at: f64,
    pub elapsed_ms: u32,
    pub status: DiagnosticStatus,
    pub phase: DiagnosticPhase,
    pub details: Vec<DiagnosticDetail>,
    pub error: Option<AppError>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticSnapshot {
    pub cursor: u32,
    pub discarded: u32,
    // None means unchanged; an empty vector is an actual empty snapshot.
    pub operations: Option<Vec<DiagnosticOperation>>,
}
