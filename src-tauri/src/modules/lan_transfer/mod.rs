#[cfg(desktop)]
pub(crate) mod commands;
mod model;
pub(crate) mod repository;
pub(crate) mod schema;
#[cfg(desktop)]
mod service;

pub use model::*;
#[cfg(desktop)]
pub use service::{network_addresses, LanTransferManager};
