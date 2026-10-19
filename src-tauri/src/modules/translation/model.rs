use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TranslationModel {
    pub id: String,
    pub name: String,
    pub family: String,
    pub quantization: String,
    pub bytes: f64,
    pub license: String,
    pub source_url: String,
    pub installed: bool,
    pub downloaded_bytes: f64,
    pub recommended: bool,
}

#[derive(Clone, Copy, Serialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TranslationPhase {
    Preparing,
    Downloading,
    Verifying,
    Loading,
    Generating,
    Stopping,
}

#[derive(Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TranslationTask {
    pub request_id: String,
    pub model_id: String,
    pub phase: TranslationPhase,
    pub completed_bytes: f64,
    pub total_bytes: f64,
}

#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TranslationSnapshot {
    pub models: Vec<TranslationModel>,
    pub selected_id: String,
    pub task: Option<TranslationTask>,
}

#[derive(Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TranslationOutput {
    pub request_id: String,
    pub sequence: u32,
    pub text: String,
}

#[derive(Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TranslationRequest {
    pub request_id: String,
    pub model_id: String,
    pub text: String,
    pub source_language: String,
    pub target_language: String,
}
