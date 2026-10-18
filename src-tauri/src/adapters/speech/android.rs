use std::sync::{Arc, OnceLock};

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{
    ipc::{Channel, InvokeResponseBody},
    Manager,
};

use super::android_events::{NativeCursor, NativeErrorCode, NativeEvent};
use crate::error::{AppError, AppResult, CustomErrorCode};
use crate::modules::speech::{model::*, select_voice, SpeechService};

#[derive(Default)]
struct AndroidSpeech {
    commands: tokio::sync::Mutex<()>,
    cursor: Arc<Mutex<NativeCursor>>,
    channel: OnceLock<Channel>,
}

#[derive(Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct Reply {
    available: bool,
    voices: Vec<SpeechVoice>,
    error_code: Option<NativeErrorCode>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Start<'a> {
    session_id: &'a str,
    segments: &'a [String],
    voice_id: &'a str,
    rate: f32,
    events: &'a Channel,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Control<'a> {
    session_id: &'a str,
    action: SpeechAction,
}

pub fn install(app: &tauri::AppHandle) {
    app.manage(AndroidSpeech::default());
}

async fn call(app: &tauri::AppHandle, command: &str, payload: impl Serialize) -> AppResult<Reply> {
    let reply: Reply = tauri_plugin_native_speech::call(app, command, payload)
        .await
        .map_err(|diagnostic| AppError::external("speech:dispatch", diagnostic))?;
    if let Some(code) = reply.error_code {
        return Err(code.into_error());
    }
    Ok(reply)
}

pub async fn catalog(app: &tauri::AppHandle) -> AppResult<SpeechCatalog> {
    let reply = call(app, "catalog", ()).await?;
    Ok(SpeechCatalog {
        available: reply.available,
        voices: reply.voices,
    })
}

fn channel(
    app: &tauri::AppHandle,
    state: &Arc<SpeechService>,
    cursor: Arc<Mutex<NativeCursor>>,
) -> Channel {
    let app = app.clone();
    let state = Arc::downgrade(state);
    // Mobile channels are registered for the process lifetime, so keep exactly one
    // instead of allocating a callback (and retaining its session) on every start.
    Channel::new(move |body| {
        let InvokeResponseBody::Json(json) = body else {
            return Ok(());
        };
        let Ok(event) = serde_json::from_str::<NativeEvent>(&json) else {
            eprintln!("Invalid Android speech event");
            return Ok(());
        };
        let Some(state) = state.upgrade() else {
            return Ok(());
        };
        let snapshot = {
            let mut cursor = cursor.lock();
            if !cursor.accept(&event) {
                return Ok(());
            }
            state.synchronize_native(
                &event.session_id,
                event.phase,
                event.segment_index,
                event.text_range,
                event.error_code.map(NativeErrorCode::into_error),
            )
        };
        if let Some(snapshot) = snapshot {
            SpeechService::notify(&app, &snapshot);
        }
        Ok(())
    })
}

pub async fn start(
    app: &tauri::AppHandle,
    state: &Arc<SpeechService>,
    request: SpeechRequest,
) -> AppResult<SpeechSnapshot> {
    let bridge = app.state::<AndroidSpeech>();
    let _guard = bridge.commands.lock().await;
    let catalog = catalog(app).await?;
    if !catalog.available {
        return Err(AppError::custom(CustomErrorCode::SpeechUnavailable));
    }
    let voice = select_voice(&catalog.voices, request.voice_id.as_deref())?;
    let events = bridge
        .channel
        .get_or_init(|| channel(app, state, Arc::clone(&bridge.cursor)));
    bridge.cursor.lock().begin(&request);
    let snapshot = state.begin(&request, voice);
    SpeechService::notify(app, &snapshot);
    if let Err(error) = call(
        app,
        "start",
        Start {
            session_id: &request.session_id,
            segments: &request.segments,
            voice_id: &voice.id,
            rate: request.rate,
            events,
        },
    )
    .await
    {
        if let Some(snapshot) = state.fail(&request.session_id, error.clone()) {
            SpeechService::notify(app, &snapshot);
        }
        return Err(error);
    }
    Ok(state.snapshot())
}

pub async fn control(
    app: &tauri::AppHandle,
    state: &Arc<SpeechService>,
    session: &str,
    action: SpeechAction,
) -> AppResult<SpeechSnapshot> {
    let bridge = app.state::<AndroidSpeech>();
    let _guard = bridge.commands.lock().await;
    if state.snapshot().session_id.as_deref() != Some(session) {
        return Ok(state.snapshot());
    }
    call(
        app,
        "control",
        Control {
            session_id: session,
            action,
        },
    )
    .await?;
    Ok(state.snapshot())
}

pub fn stop_all(app: &tauri::AppHandle, state: &Arc<SpeechService>) {
    let Some(session) = state.snapshot().session_id else {
        return;
    };
    let app = app.clone();
    let state = Arc::clone(state);
    tauri::async_runtime::spawn(async move {
        if let Err(error) = control(&app, &state, &session, SpeechAction::Stop).await {
            eprintln!("Android speech cleanup failed: {}", error.code);
        }
    });
}
