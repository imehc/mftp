//! Stable participant ids shared by two coordination paths: the maintenance
//! busy list (`data.rs`) and the Lifecycle stop-registration names in
//! `app/services.rs`. They are also the wire values of `app:data_busy`
//! `args.participant`, localized by the frontend catalog
//! (`src/lib/errors/messages.ts`), so renaming one updates all three sides.
//! Since the fifty-first batch the Lifecycle registration carries the busy
//! capability itself, so both paths query the same single registration.

use crate::error::{AppError, CustomErrorCode};

pub(crate) const SSH: &str = "ssh";
pub(crate) const LAN_TRANSFER: &str = "lan_transfer";
pub(crate) const GAME_ROOM: &str = "game_room";
pub(crate) const POETRY: &str = "poetry";
pub(crate) const BT: &str = "bt";

/// Shared by both admission paths: maintenance rejections and the lifecycle's
/// fail-closed lookup produce the same `app:data_busy` payload.
pub(crate) fn busy_error(participant: &'static str) -> AppError {
    AppError::custom(CustomErrorCode::AppDataBusy).with_arg("participant", participant)
}
