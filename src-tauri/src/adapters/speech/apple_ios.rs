//! iOS-only foreground and interruption policy for the shared Apple engine.

use std::sync::Arc;

use objc2::{define_class, msg_send, rc::Retained, sel, AnyThread, DefinedClass};
use objc2_avf_audio::{
    AVAudioSessionInterruptionNotification, AVAudioSessionInterruptionType,
    AVAudioSessionInterruptionTypeKey,
};
use objc2_foundation::{
    NSNotification, NSNotificationCenter, NSNumber, NSObject, NSObjectProtocol,
};
use objc2_ui_kit::UIApplicationDidEnterBackgroundNotification;

use crate::modules::speech::{model::SpeechAction, SpeechService};

struct SessionState {
    app: tauri::AppHandle,
    state: Arc<SpeechService>,
    session: String,
}

define_class!(
    // SAFETY: NSObject has no subclassing invariants; ivars are immutable and thread-safe.
    #[unsafe(super = NSObject)]
    #[name = "MftpSpeechLifecycle"]
    #[ivars = SessionState]
    struct SpeechLifecycle;

    unsafe impl NSObjectProtocol for SpeechLifecycle {}

    impl SpeechLifecycle {
        #[unsafe(method(stopForBackground:))]
        fn background(&self, _: &NSNotification) {
            self.stop();
        }

        #[unsafe(method(stopForInterruption:))]
        fn interruption(&self, notification: &NSNotification) {
            let began = notification.userInfo().and_then(|info| {
                // SAFETY: The SDK constant is read on its supported iOS platform.
                let key = unsafe { AVAudioSessionInterruptionTypeKey }?;
                let value = info.objectForKey(key)?;
                value.downcast_ref::<NSNumber>().map(|kind| {
                    kind.unsignedIntegerValue() == AVAudioSessionInterruptionType::Began.0
                })
            });
            if began == Some(true) {
                self.stop();
            }
        }
    }
);

// SAFETY: Notification delivery may use any thread; immutable state contains only
// a thread-safe AppHandle, service and session id. Engine access is dispatched.
unsafe impl Send for SpeechLifecycle {}
unsafe impl Sync for SpeechLifecycle {}

impl SpeechLifecycle {
    fn new(state: SessionState) -> Retained<Self> {
        let this = Self::alloc().set_ivars(state);
        // SAFETY: NSObject's initializer initializes this allocated subclass.
        unsafe { msg_send![super(this), init] }
    }

    fn stop(&self) {
        let data = self.ivars();
        let app = data.app.clone();
        let state = Arc::clone(&data.state);
        let session = data.session.clone();
        tauri::async_runtime::spawn(async move {
            let handle = app.clone();
            if let Err(error) = super::on_main(&app, move || {
                super::apple::control(&handle, &state, &session, SpeechAction::Stop)
            })
            .await
            {
                eprintln!("Speech lifecycle stop failed: {}", error.code);
            }
        });
    }
}

pub(super) struct Session {
    observer: Retained<SpeechLifecycle>,
}

impl Session {
    pub fn new(app: tauri::AppHandle, state: Arc<SpeechService>, session: String) -> Self {
        let observer = SpeechLifecycle::new(SessionState {
            app,
            state,
            session,
        });
        let center = NSNotificationCenter::defaultCenter();
        // SAFETY: Both selectors accept one NSNotification. The main-thread engine
        // retains the observer until it unregisters from this same center in Drop.
        unsafe {
            center.addObserver_selector_name_object(
                &observer,
                sel!(stopForBackground:),
                Some(UIApplicationDidEnterBackgroundNotification),
                None,
            );
            if let Some(name) = AVAudioSessionInterruptionNotification {
                center.addObserver_selector_name_object(
                    &observer,
                    sel!(stopForInterruption:),
                    Some(name),
                    None,
                );
            }
        }
        Self { observer }
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        // SAFETY: The observer remains retained until after this deregistration.
        unsafe { NSNotificationCenter::defaultCenter().removeObserver(&self.observer) };
    }
}
