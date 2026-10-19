//! Process-wide, memory-only speech state. Native objects stay in their platform adapter.

pub mod commands;
pub mod model;

use parking_lot::Mutex;

#[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
use tauri::Emitter;

use crate::error::{AppError, AppResult, CustomErrorCode};
use model::{SpeechRequest, SpeechSnapshot};
// Progress tracking and voice selection only exist where a native speech adapter does,
// so their imports stay behind the same platforms as the items below.
#[cfg(any(target_os = "macos", target_os = "ios", target_os = "android", test))]
use model::{SpeechPhase, SpeechTextRange, SpeechVoice};

#[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
pub const SPEECH_EVENT: &str = "speech://state";

#[derive(Default)]
pub struct SpeechService {
    snapshot: Mutex<SpeechSnapshot>,
}

impl SpeechService {
    pub fn snapshot(&self) -> SpeechSnapshot {
        self.snapshot.lock().clone()
    }

    /// Seeded before native playback; only the native speech adapters call it.
    #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android", test))]
    pub fn begin(&self, request: &SpeechRequest, voice: &SpeechVoice) -> SpeechSnapshot {
        let mut state = self.snapshot.lock();
        *state = SpeechSnapshot {
            revision: state.revision.saturating_add(1),
            session_id: Some(request.session_id.clone()),
            phase: SpeechPhase::Preparing,
            segment_index: 0,
            segment_count: request.segments.len() as u32,
            text_range: None,
            voice_id: Some(voice.id.clone()),
            error: None,
        };
        state.clone()
    }

    #[cfg(any(target_os = "macos", target_os = "ios", test))]
    pub fn update(
        &self,
        session: &str,
        phase: SpeechPhase,
        segment: Option<u32>,
    ) -> Option<SpeechSnapshot> {
        let mut state = self.snapshot.lock();
        if state.session_id.as_deref() != Some(session)
            || matches!(
                state.phase,
                SpeechPhase::Stopped | SpeechPhase::Finished | SpeechPhase::Failed
            )
            || (state.phase == SpeechPhase::Stopping && phase != SpeechPhase::Stopped)
        {
            return None;
        }
        state.phase = phase;
        if let Some(segment) = segment {
            if state.segment_index != segment {
                state.text_range = None;
            }
            state.segment_index = segment;
        }
        if matches!(
            phase,
            SpeechPhase::Stopping | SpeechPhase::Stopped | SpeechPhase::Finished
        ) {
            state.text_range = None;
        }
        state.revision = state.revision.saturating_add(1);
        Some(state.clone())
    }

    #[cfg(any(target_os = "macos", target_os = "ios", test))]
    pub fn progress(
        &self,
        session: &str,
        segment: u32,
        range: SpeechTextRange,
    ) -> Option<SpeechSnapshot> {
        let mut state = self.snapshot.lock();
        if state.session_id.as_deref() != Some(session)
            || state.phase != SpeechPhase::Speaking
            || state.segment_index != segment
            || range.length == 0
            || range.start.checked_add(range.length).is_none()
            || state
                .text_range
                .is_some_and(|previous| previous.start > range.start)
            || state.text_range == Some(range)
        {
            return None;
        }
        state.text_range = Some(range);
        state.revision = state.revision.saturating_add(1);
        Some(state.clone())
    }

    #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
    pub fn notify(app: &tauri::AppHandle, snapshot: &SpeechSnapshot) {
        // Native callbacks may run on another thread. Publish only after releasing the lock.
        if let Err(error) = app.emit(SPEECH_EVENT, snapshot) {
            eprintln!(
                "Speech event delivery failed: {}",
                AppError::from(error).code
            );
        }
    }

    #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
    pub fn fail(&self, session: &str, error: AppError) -> Option<SpeechSnapshot> {
        let mut state = self.snapshot.lock();
        if state.session_id.as_deref() != Some(session) {
            return None;
        }
        state.phase = SpeechPhase::Failed;
        state.text_range = None;
        state.error = Some(error);
        state.revision = state.revision.saturating_add(1);
        Some(state.clone())
    }

    /// Android restarts the current sentence on resume. Its ordered native snapshot
    /// may therefore rewind the text range, unlike continuous macOS progress.
    #[cfg(any(target_os = "android", test))]
    pub fn synchronize_native(
        &self,
        session: &str,
        phase: SpeechPhase,
        segment: u32,
        range: Option<SpeechTextRange>,
        error: Option<AppError>,
    ) -> Option<SpeechSnapshot> {
        let mut state = self.snapshot.lock();
        if state.session_id.as_deref() != Some(session)
            || segment >= state.segment_count
            || matches!(
                state.phase,
                SpeechPhase::Stopped | SpeechPhase::Finished | SpeechPhase::Failed
            )
        {
            return None;
        }
        state.phase = phase;
        state.segment_index = segment;
        state.text_range = if matches!(phase, SpeechPhase::Speaking | SpeechPhase::Paused) {
            range
        } else {
            None
        };
        state.error = error;
        state.revision = state.revision.saturating_add(1);
        Some(state.clone())
    }
}

pub fn validate(request: &SpeechRequest) -> AppResult<()> {
    if uuid::Uuid::parse_str(&request.session_id).is_err()
        || request.segments.is_empty()
        || request.segments.len() > 512
        || request.segments.iter().any(|text| text.trim().is_empty())
        || request.segments.iter().map(String::len).sum::<usize>() > 64 * 1024
        || !request.rate.is_finite()
        || !(0.5..=1.5).contains(&request.rate)
        || request.voice_id.as_ref().is_some_and(|id| id.len() > 512)
    {
        return Err(AppError::custom(CustomErrorCode::SpeechInputInvalid));
    }
    Ok(())
}

#[cfg(any(target_os = "macos", target_os = "ios", target_os = "android", test))]
pub fn select_voice<'a>(
    voices: &'a [SpeechVoice],
    preferred: Option<&str>,
) -> AppResult<&'a SpeechVoice> {
    voices
        .iter()
        .find(|voice| Some(voice.id.as_str()) == preferred)
        .or_else(|| {
            voices
                .iter()
                .filter(|voice| {
                    voice.language.starts_with("zh") || voice.language.starts_with("cmn")
                })
                .max_by_key(|voice| (voice.quality, voice.language == "zh-CN"))
        })
        .ok_or_else(|| AppError::custom(CustomErrorCode::SpeechVoiceMissing))
}

#[cfg(test)]
mod tests;
