//! Read-only poetry library queries. No activity log entries by design.

use tauri::State;

use crate::app::services::AppServices;
use crate::core::execution::run_blocking;
use crate::error::AppResult;
use crate::modules::poetry::model::{
    AuthorSummary, PoemDetail, PoemPage, PoetryAuthorsRequest, PoetryBrowseRequest,
    PoetryCollectionStatus, PoetryContentIndexStatus, PoetrySearchRequest, PoetrySearchResult,
};

#[tauri::command]
#[specta::specta]
pub async fn poetry_collections(
    state: State<'_, AppServices>,
) -> AppResult<Vec<PoetryCollectionStatus>> {
    let library = state.poetry.clone();
    run_blocking(move || library.collections_status()).await
}

#[tauri::command]
#[specta::specta]
pub async fn poetry_content_index_status(
    state: State<'_, AppServices>,
) -> AppResult<PoetryContentIndexStatus> {
    let library = state.poetry.clone();
    run_blocking(move || library.content_index_status()).await
}

#[tauri::command]
#[specta::specta]
pub async fn poetry_browse(
    state: State<'_, AppServices>,
    req: PoetryBrowseRequest,
) -> AppResult<PoemPage> {
    let db = state.poetry.db();
    run_blocking(move || db.browse(&req)).await
}

#[tauri::command]
#[specta::specta]
pub async fn poetry_poem(state: State<'_, AppServices>, uid: String) -> AppResult<PoemDetail> {
    let db = state.poetry.db();
    run_blocking(move || db.poem_detail(&uid)).await
}

#[tauri::command]
#[specta::specta]
pub async fn poetry_search(
    state: State<'_, AppServices>,
    req: PoetrySearchRequest,
) -> AppResult<PoetrySearchResult> {
    let db = state.poetry.db();
    run_blocking(move || db.search(&req)).await
}

#[tauri::command]
#[specta::specta]
pub async fn poetry_authors(
    state: State<'_, AppServices>,
    req: PoetryAuthorsRequest,
) -> AppResult<Vec<AuthorSummary>> {
    let db = state.poetry.db();
    run_blocking(move || db.authors(&req)).await
}

#[tauri::command]
#[specta::specta]
pub async fn poetry_daily(state: State<'_, AppServices>) -> AppResult<Option<PoemDetail>> {
    let db = state.poetry.db();
    run_blocking(move || db.discover_daily()).await
}

#[tauri::command]
#[specta::specta]
pub async fn poetry_random(
    state: State<'_, AppServices>,
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
