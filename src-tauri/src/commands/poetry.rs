//! Thin IPC layer for the poetry library; all logic lives in
//! `src-tauri/src/poetry/*`. Heavy work is pushed to blocking threads.

use tauri::{AppHandle, Emitter, State};

use crate::ai::{
    generate_poetry_translation as request_poetry_translation, poetry_translation_stream_event,
    read_api_key, AiTask, POETRY_TRANSLATION_PROMPT_VERSION,
};
use crate::error::{AppError, AppResult};
#[cfg(desktop)]
use crate::poetry::model::PoetryTranslationPack;
use crate::poetry::model::{
    AuthorSummary, PoemDetail, PoemPage, PoetryAnnotationsStatus, PoetryAuthorsRequest,
    PoetryBrowseRequest, PoetryCollectionStatus, PoetryContentIndexStatus, PoetryPackTranslation,
    PoetrySearchRequest, PoetrySearchResult, PoetrySyncPlan, PoetrySyncProgress, PoetryTranslation,
    PoetryTranslationMode, PoetryTranslationPackSummary, PoetryTranslationStreamEvent,
};
use crate::poetry::sync::SYNC_PROGRESS_EVENT;
use crate::poetry::text::body_fingerprint;
use crate::AppState;

use super::record_operation;
use super::run_blocking;

fn progress_emitter(app: &AppHandle) -> impl Fn(PoetrySyncProgress) + Send + Sync + 'static {
    let app = app.clone();
    move |progress| {
        let _ = app.emit(SYNC_PROGRESS_EVENT, progress);
    }
}

#[tauri::command]
#[specta::specta]
pub async fn poetry_collections(
    state: State<'_, AppState>,
) -> AppResult<Vec<PoetryCollectionStatus>> {
    let library = state.poetry.clone();
    run_blocking(move || library.collections_status()).await
}

#[tauri::command]
#[specta::specta]
pub async fn poetry_sync_check(
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<PoetrySyncPlan> {
    let _ = app;
    let library = state.poetry.clone();
    run_blocking(move || library.sync_plan(true)).await
}

#[tauri::command]
#[specta::specta]
pub async fn poetry_sync_start(
    app: AppHandle,
    state: State<'_, AppState>,
    collection_ids: Vec<String>,
) -> AppResult<()> {
    let library = state.poetry.clone();
    let emit_progress = progress_emitter(&app);
    let result =
        run_blocking(move || library.begin_network_sync(emit_progress, collection_ids)).await;
    record_operation(&state.storage, "poetry", "", "sync", None, &result);
    result
}

#[tauri::command]
#[specta::specta]
pub async fn poetry_sync_import_local(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    collection_ids: Vec<String>,
) -> AppResult<()> {
    #[cfg(mobile)]
    {
        // Mobile data installation is intentionally download-only; reject old
        // clients or direct IPC calls instead of accepting local archives.
        let _ = (app, state, path, collection_ids);
        return Err(AppError(
            "Local poetry import is not available on mobile".into(),
        ));
    }
    #[cfg(desktop)]
    {
        let library = state.poetry.clone();
        let emit_progress = progress_emitter(&app);
        let result =
            run_blocking(move || library.begin_local_import(emit_progress, path, collection_ids))
                .await;
        record_operation(&state.storage, "poetry", "", "import", None, &result);
        result
    }
}

#[tauri::command]
#[specta::specta]
pub async fn poetry_sync_cancel(state: State<'_, AppState>) -> AppResult<()> {
    let library = state.poetry.clone();
    let result = run_blocking(move || {
        library.cancel_sync();
        Ok(())
    })
    .await;
    record_operation(&state.storage, "poetry", "", "cancel", None, &result);
    result
}

#[tauri::command]
#[specta::specta]
pub async fn poetry_collection_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let library = state.poetry.clone();
    let log_id = id.clone();
    let result = run_blocking(move || library.delete_collection(&id)).await;
    record_operation(
        &state.storage,
        "poetry",
        &log_id,
        "delete_collection",
        None,
        &result,
    );
    result
}

/// Rebuild or drop the bigram body index; emits `indexing` progress events.
#[tauri::command]
#[specta::specta]
pub async fn poetry_content_index_build(
    app: AppHandle,
    state: State<'_, AppState>,
    enable: bool,
) -> AppResult<()> {
    let library = state.poetry.clone();
    let emit_progress = progress_emitter(&app);
    let result = run_blocking(move || {
        library.rebuild_body_index(enable, move |done, total| {
            emit_progress(PoetrySyncProgress {
                collection_id: "body-index".into(),
                phase: "indexing".into(),
                bytes_done: done.max(0) as u64,
                bytes_total: Some(total.max(0) as u64),
                imported: 0,
                total: None,
                error: None,
            });
        })
    })
    .await;
    record_operation(&state.storage, "poetry", "", "build_index", None, &result);
    result
}

#[tauri::command]
#[specta::specta]
pub async fn poetry_browse(
    state: State<'_, AppState>,
    req: PoetryBrowseRequest,
) -> AppResult<PoemPage> {
    let db = state.poetry.db();
    run_blocking(move || db.browse(&req)).await
}

#[tauri::command]
#[specta::specta]
pub async fn poetry_poem(state: State<'_, AppState>, uid: String) -> AppResult<PoemDetail> {
    let db = state.poetry.db();
    run_blocking(move || db.poem_detail(&uid)).await
}

#[tauri::command]
#[specta::specta]
pub async fn poetry_search(
    state: State<'_, AppState>,
    req: PoetrySearchRequest,
) -> AppResult<PoetrySearchResult> {
    let db = state.poetry.db();
    run_blocking(move || db.search(&req)).await
}

#[tauri::command]
#[specta::specta]
pub async fn poetry_authors(
    state: State<'_, AppState>,
    req: PoetryAuthorsRequest,
) -> AppResult<Vec<AuthorSummary>> {
    let db = state.poetry.db();
    run_blocking(move || db.authors(&req)).await
}

#[tauri::command]
#[specta::specta]
pub async fn poetry_daily(state: State<'_, AppState>) -> AppResult<Option<PoemDetail>> {
    let db = state.poetry.db();
    run_blocking(move || db.discover_daily()).await
}

#[tauri::command]
#[specta::specta]
pub async fn poetry_random(
    state: State<'_, AppState>,
    seed: Option<String>,
) -> AppResult<Option<PoemDetail>> {
    let db = state.poetry.db();
    run_blocking(move || {
        let seed = seed.unwrap_or_else(|| {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|duration| duration.as_nanos().to_string())
                .unwrap_or_default()
        });
        db.discover_random(&seed)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn poetry_content_index_status(
    state: State<'_, AppState>,
) -> AppResult<PoetryContentIndexStatus> {
    let library = state.poetry.clone();
    run_blocking(move || library.content_index_status()).await
}

#[tauri::command]
#[specta::specta]
pub async fn poetry_annotations_install(
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let library = state.poetry.clone();
    let emit_progress = progress_emitter(&app);
    let result = run_blocking(move || library.begin_annotations_install(emit_progress)).await;
    record_operation(
        &state.storage,
        "poetry",
        "annotations",
        "install",
        None,
        &result,
    );
    result
}

#[tauri::command]
#[specta::specta]
pub async fn poetry_annotations_status(
    state: State<'_, AppState>,
) -> AppResult<PoetryAnnotationsStatus> {
    let library = state.poetry.clone();
    run_blocking(move || {
        let (installed, entry_count) = library.annotations_status()?;
        Ok(PoetryAnnotationsStatus {
            installed,
            entry_count,
        })
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn poetry_annotations_delete(state: State<'_, AppState>) -> AppResult<()> {
    let library = state.poetry.clone();
    let result = run_blocking(move || library.annotations_delete()).await;
    record_operation(
        &state.storage,
        "poetry",
        "annotations",
        "delete",
        None,
        &result,
    );
    result
}

#[tauri::command]
#[specta::specta]
pub async fn poetry_translation_pack_import(
    state: State<'_, AppState>,
    raw: String,
) -> AppResult<i64> {
    #[cfg(mobile)]
    {
        // Translation packs are also a local import surface and remain
        // desktop-only until a controlled online pack channel is available.
        let _ = (state, raw);
        return Err(AppError(
            "Local translation pack import is not available on mobile".into(),
        ));
    }
    #[cfg(desktop)]
    {
        if raw.len() > 32 * 1024 * 1024 {
            return Err(AppError("Translation pack file is too large".into()));
        }
        let pack: PoetryTranslationPack = serde_json::from_str(&raw)
            .map_err(|error| AppError(format!("Invalid translation pack: {error}")))?;
        let library = state.poetry.clone();
        let pack_id = pack.id.clone();
        let result = run_blocking(move || library.db().import_translation_pack(&pack)).await;
        record_operation(
            &state.storage,
            "poetry",
            &pack_id,
            "import_translation_pack",
            None,
            &result,
        );
        result
    }
}

#[tauri::command]
#[specta::specta]
pub async fn poetry_translation_packs(
    state: State<'_, AppState>,
) -> AppResult<Vec<PoetryTranslationPackSummary>> {
    let db = state.poetry.db();
    run_blocking(move || db.translation_pack_summaries()).await
}

#[tauri::command]
#[specta::specta]
pub async fn poetry_translation_pack_delete(
    state: State<'_, AppState>,
    id: String,
) -> AppResult<()> {
    let db = state.poetry.db();
    let log_id = id.clone();
    let result = run_blocking(move || db.translation_pack_delete(&id)).await;
    record_operation(
        &state.storage,
        "poetry",
        &log_id,
        "delete_translation_pack",
        None,
        &result,
    );
    result
}

#[tauri::command]
#[specta::specta]
pub async fn list_poetry_pack_translations(
    state: State<'_, AppState>,
    uid: String,
) -> AppResult<Vec<PoetryPackTranslation>> {
    let db = state.poetry.db();
    run_blocking(move || {
        let poem = db.poem_detail(&uid)?;
        db.translation_pack_for_poem(&poem.uid, &body_fingerprint(&poem.body))
    })
    .await
}

const POETRY_TRANSLATION_LANGUAGE: &str = "zh-CN";

#[tauri::command]
#[specta::specta]
pub async fn list_poetry_translations(
    state: State<'_, AppState>,
    uid: String,
) -> AppResult<Vec<PoetryTranslation>> {
    let db = state.poetry.db();
    let storage = state.storage.clone();
    run_blocking(move || {
        let poem = db.poem_detail(&uid)?;
        storage.list_poetry_translations(
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
    state: State<'_, AppState>,
    uid: String,
    mode: PoetryTranslationMode,
    request_id: String,
) -> AppResult<PoetryTranslation> {
    let db = state.poetry.db();
    let storage = state.storage.clone();
    let load_storage = storage.clone();
    let tasks = state.ai_tasks.clone();
    let event_name = poetry_translation_stream_event(&request_id)?;
    let (poem, fingerprint, config) = run_blocking(move || {
        let poem = db.poem_detail(&uid)?;
        let fingerprint = body_fingerprint(&poem.body);
        let config = load_storage
            .ai_connection()?
            .ok_or_else(|| AppError("Save the AI service address and model first".into()))?;
        Ok((poem, fingerprint, config))
    })
    .await?;
    let api_key = read_api_key(&app)
        .await?
        .ok_or_else(|| AppError("Save an API key before generating a translation".into()))?;
    let ai_task = AiTask::poetry_translation(mode);
    let task_key = format!(
        "poetry:{}:{}:{}:{mode:?}:{}",
        poem.uid,
        fingerprint,
        POETRY_TRANSLATION_LANGUAGE,
        ai_task.prompt_version()
    );
    let _task = tasks.begin(task_key)?;
    let stream_app = app.clone();
    let output = request_poetry_translation(&config, &api_key, ai_task, &poem, move |delta| {
        let _ = stream_app.emit(&event_name, PoetryTranslationStreamEvent { delta });
    })
    .await?;
    let content = output.translation;
    let model = config.model;
    run_blocking(move || {
        storage.upsert_ai_poetry_translation(
            &poem.uid,
            &fingerprint,
            POETRY_TRANSLATION_LANGUAGE,
            mode,
            POETRY_TRANSLATION_PROMPT_VERSION,
            &content,
            &model,
        )
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn update_poetry_translation(
    state: State<'_, AppState>,
    uid: String,
    mode: PoetryTranslationMode,
    content: String,
) -> AppResult<PoetryTranslation> {
    let db = state.poetry.db();
    let storage = state.storage.clone();
    run_blocking(move || {
        let poem = db.poem_detail(&uid)?;
        storage.update_poetry_translation(
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
    state: State<'_, AppState>,
    uid: String,
    mode: PoetryTranslationMode,
) -> AppResult<()> {
    let db = state.poetry.db();
    let storage = state.storage.clone();
    run_blocking(move || {
        let poem = db.poem_detail(&uid)?;
        storage.delete_poetry_translation(
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
