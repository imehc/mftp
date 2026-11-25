use tauri::State;

use super::model::*;
use crate::app::services::AppServices;
use crate::error::AppResult;

#[tauri::command]
#[specta::specta]
pub async fn agent_sessions_storage(
    state: State<'_, AppServices>,
    generation: String,
    request_id: String,
) -> AppResult<AgentSessionStorage> {
    let service = state.agent_sessions.clone();
    let request = service.begin(request_id)?;
    state
        .executor
        .blocking_unlogged(move || {
            let _request = request;
            service.storage(&generation, &_request.cancel)
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn agent_sessions_snapshot(
    state: State<'_, AppServices>,
    refresh: bool,
    request_id: String,
) -> AppResult<AgentSessionsSnapshot> {
    let service = state.agent_sessions.clone();
    let request = service.begin(request_id)?;
    state
        .executor
        .blocking_unlogged(move || {
            let _request = request;
            service.snapshot(refresh, &_request.cancel)
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn agent_sessions_query(
    state: State<'_, AppServices>,
    input: AgentSessionQuery,
    request_id: String,
) -> AppResult<AgentSessionPage> {
    let service = state.agent_sessions.clone();
    let request = service.begin(request_id)?;
    state
        .executor
        .blocking_unlogged(move || {
            let _request = request;
            service.query(input, &_request.cancel)
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn agent_session_detail(
    state: State<'_, AppServices>,
    generation: String,
    key: String,
    offset: u32,
    limit: u32,
    request_id: String,
) -> AppResult<AgentSessionDetail> {
    let service = state.agent_sessions.clone();
    let request = service.begin(request_id)?;
    state
        .executor
        .blocking_unlogged(move || {
            let _request = request;
            service.detail(&generation, &key, offset, limit, &_request.cancel)
        })
        .await
}

#[tauri::command]
#[specta::specta]
pub fn agent_sessions_cancel(state: State<'_, AppServices>, request_id: String) {
    state.agent_sessions.cancel(&request_id);
}

#[tauri::command]
#[specta::specta]
pub async fn agent_session_image(
    state: State<'_, AppServices>,
    generation: String,
    key: String,
    message_index: u32,
    image_index: u32,
    request_id: String,
) -> AppResult<AgentSessionImagePayload> {
    let service = state.agent_sessions.clone();
    let request = service.begin(request_id)?;
    state
        .executor
        .blocking_unlogged(move || {
            let _request = request;
            service.image(
                &generation,
                &key,
                message_index,
                image_index,
                &_request.cancel,
            )
        })
        .await
}
