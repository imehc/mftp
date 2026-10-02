//! Shared startup/reset entry points for the AI-owned v3 schema.
use crate::error::AppResult;
use rusqlite::{Connection, Transaction};
#[cfg(test)]
pub(super) const AI_SCHEMA_VERSION: i64 = super::configuration::schema::VERSION;
pub(crate) fn init(conn: &mut Connection) -> AppResult<()> {
    super::configuration::schema::init(conn)
}
pub(crate) fn reset(tx: &Transaction<'_>) -> AppResult<usize> {
    super::configuration::schema::reset(
        tx,
        &uuid::Uuid::new_v4().to_string(),
        crate::storage::now_ms(),
    )
}
