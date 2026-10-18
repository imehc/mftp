use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SpeechVoice {
    pub id: String,
    pub name: String,
    pub language: String,
    pub quality: u8,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SpeechCatalog {
    pub available: bool,
    pub voices: Vec<SpeechVoice>,
}

#[derive(Debug, Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SpeechRequest {
    pub session_id: String,
    pub segments: Vec<String>,
    pub voice_id: Option<String>,
    pub rate: f32,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum SpeechPhase {
    #[default]
    Idle,
    Preparing,
    Speaking,
    Paused,
    Stopping,
    Stopped,
    Finished,
    Failed,
}

#[derive(Debug, Clone, Default, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SpeechSnapshot {
    pub revision: u32,
    pub session_id: Option<String>,
    pub phase: SpeechPhase,
    pub segment_index: u32,
    pub segment_count: u32,
    pub text_range: Option<SpeechTextRange>,
    pub voice_id: Option<String>,
    pub error: Option<crate::error::AppError>,
}

/// UTF-16 code units within the current utterance, matching JavaScript string offsets.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SpeechTextRange {
    pub start: u32,
    pub length: u32,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum SpeechAction {
    Pause,
    Resume,
    Stop,
}
