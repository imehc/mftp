//! Classical Chinese poetry library.
//!
//! Layout:
//! - `catalog`   — declarative collection catalog (`catalog.json`); categories
//!                 are data, never hardcoded
//! - `adapter`   — config-driven parsing abstraction for source documents
//! - `text`      — script folding, uids, FTS token generation
//! - `db`        — `poetry.sqlite3` schema + import writer
//! - `query`     — browse / search / detail / authors / discover reads
//! - `sync`      — tarball download, extraction, import orchestration
//! - `commands`  — Tauri/Specta IPC boundary
//! - `service`   — cross-domain use cases (AI translation orchestration)

pub(crate) mod adapter;
pub(crate) mod catalog;
pub(crate) mod commands;
pub(crate) mod db;
pub mod model;
pub(crate) mod query;
mod service;
pub(crate) mod sync;
pub(crate) mod text;
mod translation_pack;
pub(crate) mod translation_store;
