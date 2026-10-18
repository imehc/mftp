use super::*;
use crate::modules::speech::{model::SpeechVoice, SpeechService};

fn request() -> SpeechRequest {
    SpeechRequest {
        session_id: "session".into(),
        segments: vec!["明😀月。下一句。".into()],
        voice_id: None,
        rate: 1.0,
    }
}

fn event(sequence: u64, phase: SpeechPhase, start: u32) -> NativeEvent {
    NativeEvent {
        session_id: "session".into(),
        sequence,
        phase,
        segment_index: 0,
        text_range: Some(SpeechTextRange { start, length: 1 }),
        error_code: None,
    }
}

#[test]
fn rejects_stale_sessions_revisions_and_out_of_bounds_utf16() {
    let mut cursor = NativeCursor::default();
    cursor.begin(&request());
    assert!(cursor.accept(&event(2, SpeechPhase::Speaking, 3)));
    assert!(!cursor.accept(&event(1, SpeechPhase::Speaking, 0)));
    let mut stale = event(3, SpeechPhase::Speaking, 0);
    stale.session_id = "previous".into();
    assert!(!cursor.accept(&stale));
    assert!(!cursor.accept(&event(3, SpeechPhase::Speaking, 20)));
    assert!(cursor.accept(&event(3, SpeechPhase::Speaking, 8)));
}

#[test]
fn resume_can_rewind_sentence_but_terminal_state_ignores_late_events() {
    let state = SpeechService::default();
    state.begin(
        &request(),
        &SpeechVoice {
            id: "voice".into(),
            name: "Chinese".into(),
            language: "zh-CN".into(),
            quality: 1,
        },
    );
    for (phase, offset) in [
        (SpeechPhase::Speaking, 5),
        (SpeechPhase::Paused, 5),
        (SpeechPhase::Preparing, 0),
        (SpeechPhase::Speaking, 0),
    ] {
        state.synchronize_native(
            "session",
            phase,
            0,
            Some(SpeechTextRange {
                start: offset,
                length: 1,
            }),
            None,
        );
    }
    assert_eq!(
        state.snapshot().text_range.map(|range| range.start),
        Some(0)
    );
    state.synchronize_native("session", SpeechPhase::Stopped, 0, None, None);
    assert!(state
        .synchronize_native("session", SpeechPhase::Speaking, 0, None, None)
        .is_none());
    assert_eq!(state.snapshot().text_range, None);
}

#[test]
fn native_errors_keep_structured_codes() {
    let event: NativeEvent = serde_json::from_str(r#"{"sessionId":"session","sequence":1,"phase":"failed","segmentIndex":0,"textRange":null,"errorCode":"voice_missing"}"#).expect("valid native event");
    let mut cursor = NativeCursor::default();
    cursor.begin(&request());
    assert!(cursor.accept(&event));
    assert_eq!(
        event.error_code.expect("error code").into_error().code,
        "speech:voice_missing"
    );
}
