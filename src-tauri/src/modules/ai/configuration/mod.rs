//! AI v3 persistence and management. Secret IO is coordinated by the AI service.
pub(crate) mod commands;
#[cfg(test)]
mod fixtures;
pub(crate) mod input;
mod keys;
// Old publication paths are retained only to seed historical regression fixtures.
#[cfg(test)]
mod legacy;
pub(crate) mod model;
mod models;
mod providers;
mod read;
pub(super) mod schema;
mod selection;
mod transaction;
pub(super) mod validation;
