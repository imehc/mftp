//! Sync, annotations, body index and translation-pack commands. Writes run
//! through the shared Executor pipeline so their activity log entries cannot
//! race data maintenance.

use tauri::{AppHandle, State};

use crate::app::services::AppServices;
use crate::core::activity::OperationContext;
use crate::core::execution::run_blocking;
use crate::error::{AppError, AppResult, CustomErrorCode};
#[cfg(desktop)]
use crate::modules::poetry::model::PoetryTranslationPack;
use crate::modules::poetry::model::{
    PoetryAnnotationsStatus, PoetrySyncPlan, PoetrySyncProgress, PoetryTranslationPackSummary,
};

use super::progress_emitter;

#[tauri::command]
#[specta::specta]
pub async fn poetry_sync_check(state: State<'_, AppServices>) -> AppResult<PoetrySyncPlan> {
    let library = state.poetry.clone();
    run_blocking(move || library.sync_plan(true)).await
}

#[tauri::command]
#[specta::specta]
pub async fn poetry_sync_start(
    app: AppHandle,
    state: State<'_, AppServices>,
    collection_ids: Vec<String>,
) -> AppResult<()> {
    let library = state.poetry.clone();
    let emit_progress = progress_emitter(&app);
    state
        .executor
        .blocking(
            OperationContext::new("poetry", "sync", String::new()),
            move || library.begin_network_sync(emit_progress, collection_ids),
        )
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn poetry_sync_import_local(
    app: AppHandle,
    state: State<'_, AppServices>,
    path: String,
    collection_ids: Vec<String>,
) -> AppResult<()> {
    #[cfg(mobile)]
    {
        // Mobile data installation is intentionally download-only; reject old
        // clients or direct IPC calls instead of accepting local archives.
        let _ = (app, state, path, collection_ids);
        return Err(AppError::custom(
            CustomErrorCode::PoetryLocalImportUnsupported,
        ));
    }
    #[cfg(desktop)]
    {
        let library = state.poetry.clone();
        let emit_progress = progress_emitter(&app);
        state
            .executor
            .blocking(
                OperationContext::new("poetry", "import", String::new()),
                move || library.begin_local_import(emit_progress, path, collection_ids),
            )
            .await
    }
}

#[tauri::command]
#[specta::specta]
pub async fn poetry_sync_cancel(state: State<'_, AppServices>) -> AppResult<()> {
    let library = state.poetry.clone();
    state
        .executor
        .blocking(
            OperationContext::new("poetry", "cancel", String::new()),
            move || {
                library.cancel_sync();
                Ok(())
            },
        )
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn poetry_collection_delete(state: State<'_, AppServices>, id: String) -> AppResult<()> {
    let library = state.poetry.clone();
    let address = id.clone();
    state
        .executor
        .blocking(
            OperationContext::new("poetry", "delete_collection", address),
            move || library.delete_collection(&id),
        )
        .await
}

/// Rebuild or drop the bigram body index; emits `indexing` progress events.
#[tauri::command]
#[specta::specta]
pub async fn poetry_content_index_build(
    app: AppHandle,
    state: State<'_, AppServices>,
    enable: bool,
) -> AppResult<()> {
    let library = state.poetry.clone();
    let emit_progress = progress_emitter(&app);
    state
        .executor
        .blocking(
            OperationContext::new("poetry", "build_index", String::new()),
            move || {
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
            },
        )
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn poetry_annotations_install(
    app: AppHandle,
    state: State<'_, AppServices>,
) -> AppResult<()> {
    let library = state.poetry.clone();
    let emit_progress = progress_emitter(&app);
    state
        .executor
        .blocking(
            OperationContext::new("poetry", "install", "annotations"),
            move || library.begin_annotations_install(emit_progress),
        )
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn poetry_annotations_status(
    state: State<'_, AppServices>,
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
pub async fn poetry_annotations_delete(state: State<'_, AppServices>) -> AppResult<()> {
    let library = state.poetry.clone();
    state
        .executor
        .blocking(
            OperationContext::new("poetry", "delete", "annotations"),
            move || library.annotations_delete(),
        )
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn poetry_translation_pack_import(
    state: State<'_, AppServices>,
    raw: String,
) -> AppResult<i64> {
    #[cfg(mobile)]
    {
        // Translation packs are also a local import surface and remain
        // desktop-only until a controlled online pack channel is available.
        let _ = (state, raw);
        return Err(AppError::custom(
            CustomErrorCode::PoetryPackImportUnsupported,
        ));
    }
    #[cfg(desktop)]
    {
        if raw.len() > 32 * 1024 * 1024 {
            return Err(AppError::custom(CustomErrorCode::PoetryPackInvalid));
        }
        let pack: PoetryTranslationPack = serde_json::from_str(&raw)
            .map_err(|error| AppError::from(error).context("Invalid translation pack"))?;
        let library = state.poetry.clone();
        let address = pack.id.clone();
        state
            .executor
            .blocking(
                OperationContext::new("poetry", "import_translation_pack", address),
                move || library.db().import_translation_pack(&pack),
            )
            .await
    }
}

#[tauri::command]
#[specta::specta]
pub async fn poetry_translation_packs(
    state: State<'_, AppServices>,
) -> AppResult<Vec<PoetryTranslationPackSummary>> {
    let db = state.poetry.db();
    run_blocking(move || db.translation_pack_summaries()).await
}

#[tauri::command]
#[specta::specta]
pub async fn poetry_translation_pack_delete(
    state: State<'_, AppServices>,
    id: String,
) -> AppResult<()> {
    let db = state.poetry.db();
    let address = id.clone();
    state
        .executor
        .blocking(
            OperationContext::new("poetry", "delete_translation_pack", address),
            move || db.translation_pack_delete(&id),
        )
        .await
}
