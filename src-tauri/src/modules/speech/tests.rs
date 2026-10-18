use super::*;

fn request() -> SpeechRequest {
    SpeechRequest {
        session_id: uuid::Uuid::new_v4().to_string(),
        segments: vec![
            "床前明月光，疑是地上霜。".into(),
            "举头望明月，低头思故乡。".into(),
        ],
        voice_id: None,
        rate: 0.9,
    }
}

fn voice(id: &str, language: &str, quality: u8) -> SpeechVoice {
    SpeechVoice {
        id: id.into(),
        name: id.into(),
        language: language.into(),
        quality,
    }
}

#[test]
fn valid_poem_and_rate_are_accepted() {
    assert!(validate(&request()).is_ok());
}

#[test]
fn empty_or_oversized_speech_is_rejected_before_native_dispatch() {
    for segments in [
        vec![],
        vec![" \n".into()],
        vec!["诗".repeat(22_000)],
        vec!["诗".into(); 513],
    ] {
        let mut input = request();
        input.segments = segments;
        assert_eq!(validate(&input).unwrap_err().code, "speech:input_invalid");
    }
}

#[test]
fn invalid_rates_and_session_ids_are_rejected() {
    for rate in [f32::NAN, f32::INFINITY, -1.0, 0.49, 1.51] {
        let mut input = request();
        input.rate = rate;
        assert!(validate(&input).is_err());
    }
    let mut input = request();
    input.session_id.clear();
    assert!(validate(&input).is_err());
}

#[test]
fn preferred_voice_is_kept_and_missing_voice_falls_back_to_quality_chinese() {
    let voices = vec![
        voice("basic", "zh-CN", 1),
        voice("enhanced", "zh-CN", 2),
        voice("english", "en-US", 3),
    ];
    assert_eq!(select_voice(&voices, Some("basic")).unwrap().id, "basic");
    assert_eq!(
        select_voice(&voices, Some("removed")).unwrap().id,
        "enhanced"
    );
    assert!(select_voice(&voices[2..], None).is_err());
}

#[test]
fn callbacks_from_a_replaced_session_cannot_stop_new_speech() {
    let state = SpeechService::default();
    let first = request();
    let second = request();
    let voice = voice("chinese", "zh-CN", 2);
    state.begin(&first, &voice);
    let current = state.begin(&second, &voice);
    assert!(state
        .update(&first.session_id, SpeechPhase::Stopped, None)
        .is_none());
    assert_eq!(state.snapshot().revision, current.revision);
    assert_eq!(
        state.snapshot().session_id.as_deref(),
        Some(second.session_id.as_str())
    );
}

#[test]
fn stop_and_finish_do_not_allow_delayed_callbacks_to_restart_progress() {
    for terminal in [SpeechPhase::Stopped, SpeechPhase::Finished] {
        let state = SpeechService::default();
        let input = request();
        state.begin(&input, &voice("chinese", "zh-CN", 2));
        state.update(&input.session_id, SpeechPhase::Speaking, Some(0));
        state.update(&input.session_id, terminal, Some(1));
        assert!(state
            .update(&input.session_id, SpeechPhase::Speaking, Some(0))
            .is_none());
        assert_eq!(state.snapshot().phase, terminal);
    }
}

#[test]
fn stopping_waits_for_stop_confirmation_and_ignores_progress() {
    let state = SpeechService::default();
    let input = request();
    state.begin(&input, &voice("chinese", "zh-CN", 2));
    state.update(&input.session_id, SpeechPhase::Stopping, None);
    assert!(state
        .update(&input.session_id, SpeechPhase::Speaking, Some(1))
        .is_none());
    assert!(state
        .update(&input.session_id, SpeechPhase::Stopped, None)
        .is_some());
}

#[test]
fn text_progress_keeps_utf16_offsets_and_does_not_resume_a_paused_session() {
    let state = SpeechService::default();
    let input = request();
    state.begin(&input, &voice("chinese", "zh-CN", 2));
    state.update(&input.session_id, SpeechPhase::Speaking, Some(0));
    let range = SpeechTextRange {
        start: 2,
        length: 3,
    };
    let progress = state.progress(&input.session_id, 0, range).unwrap();
    assert_eq!(progress.text_range, Some(range));
    state.update(&input.session_id, SpeechPhase::Paused, None);
    assert!(state
        .progress(
            &input.session_id,
            0,
            SpeechTextRange {
                start: 5,
                length: 2
            }
        )
        .is_none());
    assert_eq!(state.snapshot().phase, SpeechPhase::Paused);
    assert_eq!(state.snapshot().text_range, Some(range));
}

#[test]
fn old_segment_replaced_session_and_stopped_progress_cannot_restore_highlights() {
    let state = SpeechService::default();
    let input = request();
    let range = SpeechTextRange {
        start: 0,
        length: 2,
    };
    state.begin(&input, &voice("chinese", "zh-CN", 2));
    state.update(&input.session_id, SpeechPhase::Speaking, Some(0));
    state.progress(&input.session_id, 0, range);
    state.update(&input.session_id, SpeechPhase::Speaking, Some(1));
    assert_eq!(state.snapshot().text_range, None);
    assert!(state.progress(&input.session_id, 0, range).is_none());
    state.update(&input.session_id, SpeechPhase::Stopped, None);
    assert!(state.progress(&input.session_id, 1, range).is_none());
    let replacement = request();
    state.begin(&replacement, &voice("chinese", "zh-CN", 2));
    state.update(&replacement.session_id, SpeechPhase::Speaking, Some(0));
    assert!(state.progress(&input.session_id, 0, range).is_none());
    assert_eq!(state.snapshot().text_range, None);
}

#[test]
fn duplicate_backward_and_invalid_text_progress_is_ignored() {
    let state = SpeechService::default();
    let input = request();
    state.begin(&input, &voice("chinese", "zh-CN", 2));
    state.update(&input.session_id, SpeechPhase::Speaking, Some(0));
    let range = SpeechTextRange {
        start: 3,
        length: 2,
    };
    let current = state.progress(&input.session_id, 0, range).unwrap();
    for invalid in [
        range,
        SpeechTextRange {
            start: 1,
            length: 2,
        },
        SpeechTextRange {
            start: 4,
            length: 0,
        },
        SpeechTextRange {
            start: u32::MAX,
            length: 1,
        },
    ] {
        assert!(state.progress(&input.session_id, 0, invalid).is_none());
    }
    assert_eq!(state.snapshot().revision, current.revision);
}
