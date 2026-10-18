use std::{cell::RefCell, collections::HashMap, sync::Arc};

use objc2::{
    define_class, msg_send, rc::Retained, runtime::ProtocolObject, AnyThread, DefinedClass,
};
use objc2_avf_audio::{
    AVSpeechBoundary, AVSpeechSynthesisVoice, AVSpeechSynthesizer, AVSpeechSynthesizerDelegate,
    AVSpeechUtterance,
};
use objc2_foundation::{MainThreadMarker, NSObject, NSObjectProtocol, NSRange, NSString};

use crate::error::{AppError, AppResult, CustomErrorCode};
use crate::modules::speech::{model::*, select_voice, SpeechService};

struct DelegateState {
    app: tauri::AppHandle,
    state: Arc<SpeechService>,
    session: String,
    segments: HashMap<usize, (u32, usize)>,
    last: u32,
}

define_class!(
    // SAFETY: NSObject has no subclassing invariants. All ivars are immutable and Send + Sync.
    #[unsafe(super = NSObject)]
    #[name = "MftpSpeechDelegate"]
    #[ivars = DelegateState]
    struct SpeechDelegate;

    unsafe impl NSObjectProtocol for SpeechDelegate {}

    // SAFETY: The selectors and argument types match AVSpeechSynthesizerDelegate.
    unsafe impl AVSpeechSynthesizerDelegate for SpeechDelegate {
        #[unsafe(method(speechSynthesizer:didStartSpeechUtterance:))]
        fn did_start(&self, _: &AVSpeechSynthesizer, utterance: &AVSpeechUtterance) {
            self.publish(utterance, SpeechPhase::Speaking);
        }

        #[unsafe(method(speechSynthesizer:didFinishSpeechUtterance:))]
        fn did_finish(&self, _: &AVSpeechSynthesizer, utterance: &AVSpeechUtterance) {
            if self
                .ivars()
                .segments
                .get(&utterance_key(utterance))
                .map(|value| value.0)
                == Some(self.ivars().last)
            {
                self.publish(utterance, SpeechPhase::Finished);
            }
        }

        #[unsafe(method(speechSynthesizer:didCancelSpeechUtterance:))]
        fn did_cancel(&self, _: &AVSpeechSynthesizer, utterance: &AVSpeechUtterance) {
            self.publish(utterance, SpeechPhase::Stopped);
        }

        #[unsafe(method(speechSynthesizer:didPauseSpeechUtterance:))]
        fn did_pause(&self, _: &AVSpeechSynthesizer, utterance: &AVSpeechUtterance) {
            self.publish(utterance, SpeechPhase::Paused);
        }

        #[unsafe(method(speechSynthesizer:didContinueSpeechUtterance:))]
        fn did_continue(&self, _: &AVSpeechSynthesizer, utterance: &AVSpeechUtterance) {
            self.publish(utterance, SpeechPhase::Speaking);
        }

        #[unsafe(method(speechSynthesizer:willSpeakRangeOfSpeechString:utterance:))]
        fn will_speak(
            &self,
            _: &AVSpeechSynthesizer,
            range: NSRange,
            utterance: &AVSpeechUtterance,
        ) {
            let data = self.ivars();
            let Some(&(index, length)) = data.segments.get(&utterance_key(utterance)) else {
                return;
            };
            // Validate the native UTF-16 range before crossing IPC; never slice UTF-8 with it.
            let Some(end) = range.location.checked_add(range.length) else {
                return;
            };
            if range.length == 0 || end > length {
                return;
            }
            let (Ok(start), Ok(length)) =
                (u32::try_from(range.location), u32::try_from(range.length))
            else {
                return;
            };
            if let Some(snapshot) =
                data.state
                    .progress(&data.session, index, SpeechTextRange { start, length })
            {
                SpeechService::notify(&data.app, &snapshot);
            }
        }
    }
);

// SAFETY: The delegate never mutates Objective-C state. Its immutable ivars contain a
// thread-safe service and an immutable index; native callbacks may arrive on any thread.
unsafe impl Send for SpeechDelegate {}
unsafe impl Sync for SpeechDelegate {}

impl SpeechDelegate {
    fn new(state: DelegateState) -> Retained<Self> {
        let this = Self::alloc().set_ivars(state);
        // SAFETY: NSObject's init takes no arguments and initializes the allocated subclass.
        unsafe { msg_send![super(this), init] }
    }

    fn publish(&self, utterance: &AVSpeechUtterance, phase: SpeechPhase) {
        let data = self.ivars();
        if let Some((index, _)) = data.segments.get(&utterance_key(utterance)) {
            if let Some(snapshot) = data.state.update(&data.session, phase, Some(*index)) {
                SpeechService::notify(&data.app, &snapshot);
                if matches!(phase, SpeechPhase::Stopped | SpeechPhase::Finished) {
                    retire_finished(data.app.clone(), data.session.clone());
                }
            }
        }
    }
}

fn utterance_key(utterance: &AVSpeechUtterance) -> usize {
    // Identity only: the pointer is never dereferenced or sent back to native code.
    utterance as *const AVSpeechUtterance as usize
}

struct Engine {
    synthesizer: Retained<AVSpeechSynthesizer>,
    // AVSpeechSynthesizer retains its delegate weakly.
    _delegate: Retained<SpeechDelegate>,
    #[cfg(target_os = "ios")]
    _lifecycle: super::apple_ios::Session,
}

impl Drop for Engine {
    fn drop(&mut self) {
        // SAFETY: Engines are created, accessed and dropped only on Tauri's main thread.
        unsafe {
            self.synthesizer.setDelegate(None);
            self.synthesizer
                .stopSpeakingAtBoundary(AVSpeechBoundary::Immediate);
        }
    }
}

thread_local! {
    static ENGINE: RefCell<Option<Engine>> = const { RefCell::new(None) };
}

fn retire_finished(app: tauri::AppHandle, session: String) {
    // Dispatch from a worker so a synchronous delegate callback never drops an
    // engine while start/control still borrows its main-thread slot.
    tauri::async_runtime::spawn(async move {
        if let Err(error) = app.run_on_main_thread(move || {
            ENGINE.with(|slot| {
                let Ok(mut slot) = slot.try_borrow_mut() else {
                    return;
                };
                let retire = slot.as_ref().is_some_and(|engine| {
                    let data = engine._delegate.ivars();
                    data.session == session
                        && matches!(
                            data.state.snapshot().phase,
                            SpeechPhase::Stopped | SpeechPhase::Finished | SpeechPhase::Failed
                        )
                });
                if retire {
                    slot.take();
                }
            });
        }) {
            eprintln!(
                "Speech cleanup dispatch failed: {}",
                AppError::from(error).code
            );
        }
    });
}

fn check_main() -> AppResult<()> {
    MainThreadMarker::new().map(|_| ()).ok_or_else(|| {
        AppError::external("speech:thread", "Speech engine requires the main thread")
    })
}

pub fn catalog() -> AppResult<SpeechCatalog> {
    check_main()?;
    if objc2::runtime::AnyClass::get(c"AVSpeechSynthesizer").is_none() {
        return Ok(SpeechCatalog {
            available: false,
            voices: vec![],
        });
    }
    // SAFETY: All voice APIs are called on the main thread, with retained results.
    let voices = unsafe { AVSpeechSynthesisVoice::speechVoices() };
    let mut voices: Vec<_> = voices
        .iter()
        .map(|voice| unsafe {
            SpeechVoice {
                id: voice.identifier().to_string(),
                name: voice.name().to_string(),
                language: voice.language().to_string(),
                quality: voice.quality().0.clamp(0, 3) as u8,
            }
        })
        .collect();
    voices.sort_by(|a, b| {
        b.quality
            .cmp(&a.quality)
            .then(a.name.cmp(&b.name))
            .then(a.id.cmp(&b.id))
    });
    Ok(SpeechCatalog {
        available: true,
        voices,
    })
}

pub fn start(
    app: tauri::AppHandle,
    state: Arc<SpeechService>,
    request: SpeechRequest,
) -> AppResult<SpeechSnapshot> {
    check_main()?;
    let voices = catalog()?.voices;
    let selected = select_voice(&voices, request.voice_id.as_deref())?;
    // SAFETY: The identifier came from the device's live voice catalog.
    let voice =
        unsafe { AVSpeechSynthesisVoice::voiceWithIdentifier(&NSString::from_str(&selected.id)) }
            .ok_or_else(|| AppError::custom(CustomErrorCode::SpeechVoiceMissing))?;
    let utterances: Vec<_> = request
        .segments
        .iter()
        .map(|text| unsafe {
            // The caller validated text length and rate. Full paragraphs preserve sentence prosody.
            let utterance = AVSpeechUtterance::speechUtteranceWithString(&NSString::from_str(text));
            utterance.setVoice(Some(&voice));
            utterance.setRate(0.5 * request.rate);
            utterance.setPostUtteranceDelay(0.35);
            utterance
        })
        .collect();
    ENGINE.with(|slot| {
        let mut slot = slot
            .try_borrow_mut()
            .map_err(|_| AppError::custom(CustomErrorCode::SpeechBusy))?;
        // Retire the old delegate before publishing a replacement session. Its late
        // callbacks still carry the old session id and cannot alter the replacement.
        slot.take();
        let snapshot = state.begin(&request, selected);
        SpeechService::notify(&app, &snapshot);
        let delegate = SpeechDelegate::new(DelegateState {
            app: app.clone(),
            state: state.clone(),
            session: request.session_id,
            segments: utterances
                .iter()
                .enumerate()
                .map(|(i, u)| {
                    (
                        utterance_key(u),
                        (i as u32, request.segments[i].encode_utf16().count()),
                    )
                })
                .collect(),
            last: (utterances.len() - 1) as u32,
        });
        // SAFETY: The main-thread engine owns its delegate for the entire queue lifetime.
        unsafe {
            let synthesizer = AVSpeechSynthesizer::new();
            // Let iOS own activation and deactivation for this synthesizer only;
            // changing the shared app session could disrupt other audio features.
            #[cfg(target_os = "ios")]
            synthesizer.setUsesApplicationAudioSession(false);
            synthesizer.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
            #[cfg(target_os = "ios")]
            let lifecycle = super::apple_ios::Session::new(
                app.clone(),
                Arc::clone(&state),
                delegate.ivars().session.clone(),
            );
            for utterance in &utterances {
                synthesizer.speakUtterance(utterance);
            }
            *slot = Some(Engine {
                synthesizer,
                _delegate: delegate,
                #[cfg(target_os = "ios")]
                _lifecycle: lifecycle,
            });
        }
        Ok(state.snapshot())
    })
}

pub fn control(
    app: &tauri::AppHandle,
    state: &Arc<SpeechService>,
    session: &str,
    action: SpeechAction,
) -> AppResult<SpeechSnapshot> {
    check_main()?;
    let current = state.snapshot();
    if current.session_id.as_deref() != Some(session)
        || (matches!(
            current.phase,
            SpeechPhase::Idle | SpeechPhase::Stopped | SpeechPhase::Finished | SpeechPhase::Failed
        ) && !matches!(action, SpeechAction::Stop))
    {
        return Ok(current);
    }
    ENGINE.with(|slot| {
        let mut slot = slot
            .try_borrow_mut()
            .map_err(|_| AppError::custom(CustomErrorCode::SpeechBusy))?;
        let Some(engine) = slot.as_ref() else {
            return Ok(state.snapshot());
        };
        // SAFETY: Access is confined to the main thread; the engine and delegate are retained.
        let (success, phase) = unsafe {
            match action {
                SpeechAction::Pause => (
                    engine.synthesizer.isPaused()
                        || engine
                            .synthesizer
                            .pauseSpeakingAtBoundary(AVSpeechBoundary::Immediate),
                    SpeechPhase::Paused,
                ),
                SpeechAction::Resume => (
                    !engine.synthesizer.isPaused() || engine.synthesizer.continueSpeaking(),
                    SpeechPhase::Speaking,
                ),
                SpeechAction::Stop => {
                    if let Some(snapshot) = state.update(session, SpeechPhase::Stopping, None) {
                        SpeechService::notify(app, &snapshot);
                    }
                    (
                        engine
                            .synthesizer
                            .stopSpeakingAtBoundary(AVSpeechBoundary::Immediate)
                            || !engine.synthesizer.isSpeaking(),
                        SpeechPhase::Stopped,
                    )
                }
            }
        };
        if !success {
            return Err(AppError::custom(CustomErrorCode::SpeechControlFailed));
        }
        if let Some(snapshot) = state.update(session, phase, None) {
            SpeechService::notify(app, &snapshot);
        }
        if matches!(action, SpeechAction::Stop) {
            slot.take();
        }
        Ok(state.snapshot())
    })
}

pub fn stop_all(app: &tauri::AppHandle, state: &Arc<SpeechService>) {
    if let Some(session) = state.snapshot().session_id {
        if let Err(error) = control(app, state, &session, SpeechAction::Stop) {
            eprintln!("Speech shutdown failed: {}", error.code);
        }
    }
}
