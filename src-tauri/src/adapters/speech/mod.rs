use std::sync::Arc;

#[cfg(not(target_os = "android"))]
use crate::error::AppError;
use crate::error::AppResult;
use crate::modules::speech::{model::*, SpeechService};

#[cfg(any(target_os = "macos", target_os = "ios"))]
mod apple;
#[cfg(target_os = "ios")]
mod apple_ios;
#[cfg(any(target_os = "macos", target_os = "ios"))]
pub use apple::stop_all;
#[cfg(target_os = "android")]
mod android;
#[cfg(target_os = "android")]
pub use android::{install, stop_all};
#[cfg(any(target_os = "android", test))]
mod android_events;

#[cfg(any(target_os = "macos", target_os = "ios"))]
async fn on_main<T: Send + 'static>(
    app: &tauri::AppHandle,
    operation: impl FnOnce() -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    let (send, receive) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let _ = send.send(operation());
    })?;
    receive.await.map_err(|_| {
        AppError::external(
            "speech:dispatch",
            "Speech main-thread operation was cancelled",
        )
    })?
}

pub async fn catalog(_app: &tauri::AppHandle) -> AppResult<SpeechCatalog> {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    return on_main(_app, apple::catalog).await;
    #[cfg(target_os = "android")]
    return android::catalog(_app).await;
    #[cfg(not(any(target_os = "macos", target_os = "ios", target_os = "android")))]
    Ok(SpeechCatalog {
        available: false,
        voices: vec![],
    })
}

pub async fn start(
    _app: tauri::AppHandle,
    _state: Arc<SpeechService>,
    _request: SpeechRequest,
) -> AppResult<SpeechSnapshot> {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        let handle = _app.clone();
        return on_main(&_app, move || apple::start(handle, _state, _request)).await;
    }
    #[cfg(target_os = "android")]
    return android::start(&_app, &_state, _request).await;
    #[cfg(not(any(target_os = "macos", target_os = "ios", target_os = "android")))]
    Err(AppError::custom(
        crate::error::CustomErrorCode::SpeechUnavailable,
    ))
}

pub async fn control(
    _app: &tauri::AppHandle,
    state: &Arc<SpeechService>,
    _session: &str,
    _action: SpeechAction,
) -> AppResult<SpeechSnapshot> {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        let handle = _app.clone();
        let state = Arc::clone(state);
        let session = _session.to_owned();
        return on_main(_app, move || {
            apple::control(&handle, &state, &session, _action)
        })
        .await;
    }
    #[cfg(target_os = "android")]
    return android::control(_app, state, _session, _action).await;
    #[cfg(not(any(target_os = "macos", target_os = "ios", target_os = "android")))]
    Ok(state.snapshot())
}

#[cfg(not(any(target_os = "macos", target_os = "ios", target_os = "android")))]
pub fn stop_all(_: &tauri::AppHandle, _: &Arc<SpeechService>) {}

#[cfg(any(target_os = "macos", target_os = "ios"))]
pub async fn check_startup(app: tauri::AppHandle, state: Arc<SpeechService>, session: String) {
    let handle = app.clone();
    if let Err(error) = on_main(&app, move || {
        let snapshot = state.snapshot();
        if snapshot.session_id.as_deref() == Some(&session)
            && snapshot.phase == SpeechPhase::Preparing
        {
            let error = apple::control(&handle, &state, &session, SpeechAction::Stop)
                .err()
                .unwrap_or_else(|| {
                    AppError::custom(crate::error::CustomErrorCode::SpeechStartFailed)
                });
            if let Some(snapshot) = state.fail(&session, error) {
                SpeechService::notify(&handle, &snapshot);
            }
        }
        Ok(())
    })
    .await
    {
        crate::runtime_log!("Speech startup check failed: {}", error.code);
    }
}
