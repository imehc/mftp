//! Translation list/save/generate commands. AI-backed generation streams
//! deltas on the request-scoped event and persists through storage.

use tauri::{AppHandle, Emitter, State};

use crate::app::services::AppServices;
use crate::core::execution::run_blocking;
use crate::error::AppResult;
use crate::modules::ai::poetry_translation_stream_event;
use crate::modules::poetry::model::{
    PoetryPackTranslation, PoetryTranslation, PoetryTranslationMode, PoetryTranslationStreamEvent,
};
use crate::modules::poetry::service::{
    self as translation_service, PoetryTranslationJob, POETRY_TRANSLATION_LANGUAGE,
    POETRY_TRANSLATION_PROMPT_VERSION,
};
use crate::modules::poetry::text::body_fingerprint;
use crate::modules::poetry::translation_store;

#[tauri::command]
#[specta::specta]
pub async fn list_poetry_pack_translations(
    state: State<'_, AppServices>,
    uid: String,
) -> AppResult<Vec<PoetryPackTranslation>> {
    let db = state.poetry.db();
    run_blocking(move || {
        let poem = db.poem_detail(&uid)?;
        db.translation_pack_for_poem(&poem.uid, &body_fingerprint(&poem.body))
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn list_poetry_translations(
    state: State<'_, AppServices>,
    uid: String,
) -> AppResult<Vec<PoetryTranslation>> {
    let db = state.poetry.db();
    let storage = state.storage.clone();
    run_blocking(move || {
        let poem = db.poem_detail(&uid)?;
        translation_store::list(
            &storage,
            &poem.uid,
            &body_fingerprint(&poem.body),
            POETRY_TRANSLATION_LANGUAGE,
            POETRY_TRANSLATION_PROMPT_VERSION,
        )
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn generate_poetry_translation(
    app: AppHandle,
    state: State<'_, AppServices>,
    uid: String,
    mode: PoetryTranslationMode,
    request_id: String,
) -> AppResult<PoetryTranslation> {
    let event_name = poetry_translation_stream_event(&request_id)?;
    let db = state.poetry.db();
    let storage = state.storage.clone();
    let tasks = state.ai_tasks.clone();
    translation_service::generate_poetry_translation(
        db,
        storage,
        &state.ai_configuration,
        tasks,
        PoetryTranslationJob {
            uid,
            mode,
            request_id,
        },
        move |delta| {
            let _ = app.emit(&event_name, PoetryTranslationStreamEvent { delta });
        },
    )
    .await
}

/// Stops an in-flight generation. The provider stream ends with `ai:cancelled`
/// and nothing is persisted, so the poem keeps its previous translation.
#[tauri::command]
#[specta::specta]
pub fn cancel_poetry_translation(
    state: State<'_, AppServices>,
    request_id: String,
) -> AppResult<()> {
    // Reject malformed ids the same way the stream event does; anything else
    // (already finished, never started) is a harmless miss.
    let _ = poetry_translation_stream_event(&request_id)?;
    state.ai_tasks.cancel(&request_id);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn update_poetry_translation(
    state: State<'_, AppServices>,
    uid: String,
    mode: PoetryTranslationMode,
    content: String,
) -> AppResult<PoetryTranslation> {
    let db = state.poetry.db();
    let storage = state.storage.clone();
    run_blocking(move || {
        let poem = db.poem_detail(&uid)?;
        translation_store::update(
            &storage,
            &poem.uid,
            &body_fingerprint(&poem.body),
            POETRY_TRANSLATION_LANGUAGE,
            mode,
            POETRY_TRANSLATION_PROMPT_VERSION,
            &content,
        )
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn delete_poetry_translation(
    state: State<'_, AppServices>,
    uid: String,
    mode: PoetryTranslationMode,
) -> AppResult<()> {
    let db = state.poetry.db();
    let storage = state.storage.clone();
    run_blocking(move || {
        let poem = db.poem_detail(&uid)?;
        translation_store::delete(
            &storage,
            &poem.uid,
            &body_fingerprint(&poem.body),
            POETRY_TRANSLATION_LANGUAGE,
            mode,
            POETRY_TRANSLATION_PROMPT_VERSION,
        )?;
        Ok(())
    })
    .await
}
