use crate::error::{AppError, AppResult};
use crate::models::{GameRoomStatus, GameRoomSummary};
use crate::AppState;
use tauri::State;

use super::record_operation;
use super::run_blocking;

#[tauri::command]
#[specta::specta]
pub fn game_room_status(state: State<AppState>) -> AppResult<GameRoomStatus> {
    Ok(state.game_room.status())
}

#[tauri::command]
#[specta::specta]
pub async fn game_room_create(
    state: State<'_, AppState>,
    game_id: String,
    room_name: String,
    code: Option<String>,
    player_name: String,
) -> AppResult<GameRoomStatus> {
    let manager = state.game_room.clone();
    let log_game_id = game_id.clone();
    let result = run_blocking(move || {
        manager
            .create(game_id, room_name, code, player_name)
            .map_err(AppError::from)
    })
    .await;
    record_operation(
        &state.storage,
        "games",
        &log_game_id,
        "create_room",
        None,
        &result,
    );
    result
}

#[tauri::command]
#[specta::specta]
pub async fn game_room_join(
    state: State<'_, AppState>,
    host: String,
    port: u16,
    game_id: String,
    code: Option<String>,
    player_name: String,
) -> AppResult<GameRoomStatus> {
    let manager = state.game_room.clone();
    let log_host = host.clone();
    let result = run_blocking(move || {
        manager
            .join(host, port, game_id, code, player_name)
            .map_err(AppError::from)
    })
    .await;
    record_operation(
        &state.storage,
        "games",
        &log_host,
        "join_room",
        None,
        &result,
    );
    result
}

#[tauri::command]
#[specta::specta]
pub async fn game_room_discover(
    state: State<'_, AppState>,
    game_id: String,
) -> AppResult<Vec<GameRoomSummary>> {
    let manager = state.game_room.clone();
    run_blocking(move || Ok(manager.discover(&game_id))).await
}

#[tauri::command]
#[specta::specta]
pub fn game_room_send(state: State<AppState>, payload: String) -> AppResult<()> {
    state.game_room.send(payload).map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub fn game_room_leave(state: State<AppState>) -> AppResult<()> {
    state.game_room.leave();
    let result = Ok(());
    record_operation(&state.storage, "games", "", "leave_room", None, &result);
    result
}
