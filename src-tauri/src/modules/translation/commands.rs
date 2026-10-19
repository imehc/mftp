use super::{catalog, download, files, model::*};
use crate::app::services::AppServices;
use crate::core::activity::OperationContext;
use crate::core::execution::run_blocking;
use crate::error::{AppError, AppResult, CustomErrorCode};
use tauri::{ipc::Channel, State, WebviewWindow};

#[tauri::command]
#[specta::specta]
pub async fn translation_snapshot(state: State<'_, AppServices>) -> AppResult<TranslationSnapshot> {
    let service = state.translation.clone();
    state
        .executor
        .blocking_unlogged(move || service.snapshot())
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn translation_select(
    state: State<'_, AppServices>,
    window: WebviewWindow,
    model_id: String,
) -> AppResult<()> {
    let service = state.translation.clone();
    let worker = service.begin(
        window.label().into(),
        uuid::Uuid::new_v4().to_string(),
        &model_id,
    )?;
    run_blocking(move || {
        let _worker = worker;
        files::prepare(&service.root)?;
        files::select(&service.root, &model_id)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn translation_download(
    state: State<'_, AppServices>,
    window: WebviewWindow,
    model_id: String,
    request_id: String,
) -> AppResult<()> {
    let service = state.translation.clone();
    let worker = service.begin(window.label().into(), request_id.clone(), &model_id)?;
    let diagnostics = state.diagnostics.clone();
    let mut context = OperationContext::new("translation", "model_download", &model_id);
    context.operation_id = Some(request_id);
    state
        .executor
        .blocking(context, move || {
            let worker = worker;
            download::install(
                &service.root,
                catalog::find(&model_id)?,
                &worker,
                &diagnostics,
            )
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn translation_remove(
    state: State<'_, AppServices>,
    window: WebviewWindow,
    model_id: String,
) -> AppResult<()> {
    let service = state.translation.clone();
    let worker = service.begin(
        window.label().into(),
        uuid::Uuid::new_v4().to_string(),
        &model_id,
    )?;
    run_blocking(move || {
        let worker = worker;
        files::cancelled(&worker.cancel)?;
        let model = catalog::find(&model_id)?;
        // Mapped weights must be unloaded before deletion (required on Windows).
        mftp_translation_engine::release();
        for path in [
            files::model_path(&service.root, model),
            files::verified_path(&files::model_path(&service.root, model)),
            files::partial_path(&service.root, model),
            files::partial_path(&service.root, model).with_extension("etag"),
        ] {
            if files::size(&path)?.is_some() {
                std::fs::remove_file(path)?;
            }
        }
        Ok(())
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn translation_run(
    state: State<'_, AppServices>,
    window: WebviewWindow,
    request: TranslationRequest,
    on_output: Channel<TranslationOutput>,
) -> AppResult<String> {
    let service = state.translation.clone();
    let worker = service.begin(
        window.label().into(),
        request.request_id.clone(),
        &request.model_id,
    )?;
    run_blocking(move || service.generate(&worker, request, on_output)).await
}

#[tauri::command]
#[specta::specta]
pub fn translation_cancel(
    state: State<'_, AppServices>,
    window: WebviewWindow,
    request_id: String,
) -> AppResult<()> {
    if uuid::Uuid::parse_str(&request_id).is_err() {
        return Err(AppError::custom(CustomErrorCode::TranslationInputInvalid));
    }
    state.translation.cancel(window.label(), &request_id);
    Ok(())
}
