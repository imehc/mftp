use tauri::State;

use super::model::*;
use crate::app::services::AppServices;
use crate::error::AppResult;

// Non-macOS test hosts export the same signatures without compiling readers.
macro_rules! mac_source {
    (($($argument:expr),*), $operation:block) => {{
        #[cfg(target_os = "macos")]
        { $operation }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = ($($argument),*);
            Err(crate::error::AppError::external(
                "agent_sessions:unsupported",
                "Local agent session access requires macOS",
            ))
        }
    }};
}

#[tauri::command]
#[specta::specta]
pub async fn agent_sessions_storage(
    state: State<'_, AppServices>,
    generation: String,
    request_id: String,
) -> AppResult<AgentSessionStorage> {
    mac_source!((state, generation, request_id), {
        let service = state.agent_sessions.clone();
        let request = service.begin(request_id)?;
        state
            .executor
            .blocking_unlogged(move || {
                let _request = request;
                service.storage(&generation, &_request.cancel)
            })
            .await
    })
}

#[tauri::command]
#[specta::specta]
pub async fn agent_sessions_snapshot(
    state: State<'_, AppServices>,
    refresh: bool,
    request_id: String,
) -> AppResult<AgentSessionsSnapshot> {
    mac_source!((state, refresh, request_id), {
        let service = state.agent_sessions.clone();
        let request = service.begin(request_id)?;
        state
            .executor
            .blocking_unlogged(move || {
                let _request = request;
                service.snapshot(refresh, &_request.cancel)
            })
            .await
    })
}

#[tauri::command]
#[specta::specta]
pub async fn agent_sessions_query(
    state: State<'_, AppServices>,
    input: AgentSessionQuery,
    request_id: String,
) -> AppResult<AgentSessionPage> {
    mac_source!(
        (
            state,
            request_id,
            input.generation,
            input.agent,
            input.archived,
            input.search,
            input.from,
            input.to,
            input.sort,
            input.min_bytes,
            input.offset,
            input.limit
        ),
        {
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
    )
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
    mac_source!((state, generation, key, offset, limit, request_id), {
        let service = state.agent_sessions.clone();
        let request = service.begin(request_id)?;
        state
            .executor
            .blocking_unlogged(move || {
                let _request = request;
                service.detail(&generation, &key, offset, limit, &_request.cancel)
            })
            .await
    })
}

#[tauri::command]
#[specta::specta]
pub fn agent_sessions_cancel(state: State<'_, AppServices>, request_id: String) {
    #[cfg(target_os = "macos")]
    state.agent_sessions.cancel(&request_id);
    #[cfg(not(target_os = "macos"))]
    let _ = (state, request_id);
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
    mac_source!(
        (
            state,
            generation,
            key,
            message_index,
            image_index,
            request_id
        ),
        {
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
    )
}
