//! Thin IPC layer for the poetry library; all logic lives in
//! `src-tauri/src/poetry/*`. Heavy work is pushed to blocking threads.

use tauri::{AppHandle, Emitter, State};

use crate::error::AppResult;
use crate::poetry::model::{
    AuthorSummary, PoemDetail, PoemPage, PoetryAnnotationsStatus, PoetryAuthorsRequest,
    PoetryBrowseRequest, PoetryCollectionStatus, PoetryContentIndexStatus, PoetrySearchRequest,
    PoetrySearchResult, PoetrySyncPlan, PoetrySyncProgress,
};
use crate::poetry::sync::SYNC_PROGRESS_EVENT;
use crate::AppState;

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
    run_blocking(move || library.begin_network_sync(emit_progress, collection_ids)).await
}

#[tauri::command]
#[specta::specta]
pub async fn poetry_sync_import_local(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    collection_ids: Vec<String>,
) -> AppResult<()> {
    let library = state.poetry.clone();
    let emit_progress = progress_emitter(&app);
    run_blocking(move || library.begin_local_import(emit_progress, path, collection_ids)).await
}

#[tauri::command]
#[specta::specta]
pub async fn poetry_sync_cancel(state: State<'_, AppState>) -> AppResult<()> {
    let library = state.poetry.clone();
    run_blocking(move || {
        library.cancel_sync();
        Ok(())
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn poetry_collection_delete(
    state: State<'_, AppState>,
    id: String,
) -> AppResult<()> {
    let library = state.poetry.clone();
    run_blocking(move || library.delete_collection(&id)).await
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
    run_blocking(move || {
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
    .await
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
pub async fn poetry_annotations_install(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    let library = state.poetry.clone();
    let emit_progress = progress_emitter(&app);
    run_blocking(move || library.begin_annotations_install(emit_progress)).await
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
    run_blocking(move || library.annotations_delete()).await
}
