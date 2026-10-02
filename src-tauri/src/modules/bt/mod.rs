//! BT owns its contract and persistence; only supported targets build the engine.

// All platforms keep the schema so shared database startup/reset retains history.
#[cfg(any(desktop, target_os = "android"))]
pub(crate) mod commands;
#[cfg(any(desktop, target_os = "android"))]
mod model;
#[cfg(any(desktop, target_os = "android"))]
pub(crate) mod ports;
#[cfg(any(desktop, target_os = "android"))]
pub(crate) mod repository;
pub(crate) mod schema;
#[cfg(any(desktop, target_os = "android"))]
mod service;

#[cfg(any(desktop, target_os = "android"))]
pub(crate) use model::*;
#[cfg(any(desktop, target_os = "android"))]
pub(crate) use service::BtManager;
