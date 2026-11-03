use super::{GamePartyCreateInput, GamePartyEnvelope, GamePartyJoinInput, GamePartyStatus};
use super::{GameRoomStatus, GameRoomSummary};
use crate::app::services::AppServices;
use crate::core::activity::OperationContext;
use crate::error::AppResult;
use tauri::State;

#[tauri::command]
#[specta::specta]
pub async fn game_room_status(state: State<'_, AppServices>) -> AppResult<GameRoomStatus> {
    let manager = state.game_room.clone();
    state
        .executor
        .blocking_unlogged(move || Ok(manager.status()))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn game_room_create(
    state: State<'_, AppServices>,
    game_id: String,
    room_name: String,
    code: Option<String>,
    player_name: String,
) -> AppResult<GameRoomStatus> {
    let manager = state.game_room.clone();
    state
        .executor
        .blocking(
            OperationContext::new("games", "create_room", game_id.clone()),
            move || manager.create(game_id, room_name, code, player_name),
        )
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn game_room_join(
    state: State<'_, AppServices>,
    host: String,
    port: u16,
    game_id: String,
    code: Option<String>,
    player_name: String,
) -> AppResult<GameRoomStatus> {
    let manager = state.game_room.clone();
    state
        .executor
        .blocking(
            OperationContext::new("games", "join_room", host.clone()),
            move || manager.join(host, port, game_id, code, player_name),
        )
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn game_room_discover(
    state: State<'_, AppServices>,
    game_id: String,
) -> AppResult<Vec<GameRoomSummary>> {
    let manager = state.game_room.clone();
    state
        .executor
        .blocking_unlogged(move || manager.discover(&game_id))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn game_room_send(
    state: State<'_, AppServices>,
    instance_id: String,
    payload: String,
) -> AppResult<()> {
    let manager = state.game_room.clone();
    // Socket writes and their serialization mutex must not block the IPC thread.
    state
        .executor
        .blocking_unlogged(move || manager.send(&instance_id, payload))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn game_room_leave(state: State<'_, AppServices>, instance_id: String) -> AppResult<()> {
    let manager = state.game_room.clone();
    state
        .executor
        .blocking(
            OperationContext::new("games", "leave_room", ""),
            move || {
                manager.leave_instance(&instance_id);
                Ok(())
            },
        )
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn game_party_status(
    state: State<'_, AppServices>,
) -> AppResult<Option<GamePartyStatus>> {
    let manager = state.game_room.clone();
    state
        .executor
        .blocking_unlogged(move || Ok(manager.party_status()))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn game_party_create(
    state: State<'_, AppServices>,
    input: GamePartyCreateInput,
) -> AppResult<GamePartyStatus> {
    let manager = state.game_room.clone();
    state
        .executor
        .blocking(
            OperationContext::new("games", "create_party", input.game_id.clone()),
            move || manager.create_party(input),
        )
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn game_party_join(
    state: State<'_, AppServices>,
    input: GamePartyJoinInput,
) -> AppResult<GamePartyStatus> {
    let manager = state.game_room.clone();
    state
        .executor
        .blocking(
            OperationContext::new("games", "join_party", input.host.clone()),
            move || manager.join_party(input),
        )
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn game_party_resume(
    state: State<'_, AppServices>,
    instance_id: String,
) -> AppResult<GamePartyStatus> {
    let manager = state.game_room.clone();
    state
        .executor
        .blocking(
            OperationContext::new("games", "resume_party", instance_id.clone()),
            move || manager.resume_party(&instance_id),
        )
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn game_party_send(
    state: State<'_, AppServices>,
    instance_id: String,
    target_member_id: Option<String>,
    envelope: GamePartyEnvelope,
) -> AppResult<()> {
    let manager = state.game_room.clone();
    state
        .executor
        .blocking_unlogged(move || manager.send_party(&instance_id, target_member_id, envelope))
        .await
}
