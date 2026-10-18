use serde::Deserialize;

use crate::error::{AppError, CustomErrorCode};
use crate::modules::speech::model::{SpeechPhase, SpeechRequest, SpeechTextRange};

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum NativeErrorCode {
    Unavailable,
    InputInvalid,
    VoiceMissing,
    StartFailed,
    ControlFailed,
}

impl NativeErrorCode {
    pub(super) fn into_error(self) -> AppError {
        AppError::custom(match self {
            Self::Unavailable => CustomErrorCode::SpeechUnavailable,
            Self::InputInvalid => CustomErrorCode::SpeechInputInvalid,
            Self::VoiceMissing => CustomErrorCode::SpeechVoiceMissing,
            Self::StartFailed => CustomErrorCode::SpeechStartFailed,
            Self::ControlFailed => CustomErrorCode::SpeechControlFailed,
        })
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct NativeEvent {
    pub session_id: String,
    pub sequence: u64,
    pub phase: SpeechPhase,
    pub segment_index: u32,
    pub text_range: Option<SpeechTextRange>,
    pub error_code: Option<NativeErrorCode>,
}

#[derive(Default)]
pub(super) struct NativeCursor {
    session: String,
    sequence: u64,
    lengths: Vec<u32>,
}

impl NativeCursor {
    pub(super) fn begin(&mut self, request: &SpeechRequest) {
        self.session.clone_from(&request.session_id);
        self.sequence = 0;
        self.lengths = request
            .segments
            .iter()
            .map(|text| text.encode_utf16().count() as u32)
            .collect();
    }

    pub(super) fn accept(&mut self, event: &NativeEvent) -> bool {
        let Some(length) = self.lengths.get(event.segment_index as usize) else {
            return false;
        };
        if event.session_id != self.session
            || event.sequence <= self.sequence
            || event.phase == SpeechPhase::Idle
            || (event.phase == SpeechPhase::Failed) != event.error_code.is_some()
            || event.text_range.is_some_and(|range| {
                range.length == 0
                    || range
                        .start
                        .checked_add(range.length)
                        .is_none_or(|end| end > *length)
            })
        {
            return false;
        }
        self.sequence = event.sequence;
        true
    }
}

#[cfg(test)]
#[path = "android_events_tests.rs"]
mod tests;
