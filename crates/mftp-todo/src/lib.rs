//! Shared todo models, rules, migrations and SQLite repository.

pub mod events;
pub mod model;
mod query;
pub mod repository;
pub mod schema;

use mftp_foundation::AppResult;
use rusqlite::Connection;

/// Return a connection with foreign keys and platform policies already configured.
pub trait Database: Send + Sync {
    fn conn(&self) -> AppResult<Connection>;
}

pub use query::{
    TodoProjection, TodoRecord, TodoView, classify, closure_time, group_date, planned_date,
};
pub use repository::TodoRepository;

#[cfg(test)]
mod tests;
