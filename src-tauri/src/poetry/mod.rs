//! Poetry library (古诗词).
//!
//! Layout:
//! - `catalog`   — declarative collection catalog (`catalog.json`); categories
//!                 are data, never hardcoded
//! - `adapter`   — config-driven parsing abstraction for source documents
//! - `text`      — script folding, uids, FTS token generation
//! - `db`        — `poetry.sqlite3` schema + import writer
//! - `query`     — browse / search / detail / authors / discover reads
//! - `sync`      — tarball download, extraction, import orchestration
//!
//! Command wrappers live in `src-tauri/src/commands/poetry.rs`.

pub(crate) mod adapter;
pub(crate) mod catalog;
pub(crate) mod db;
pub mod model;
pub(crate) mod query;
pub(crate) mod sync;
pub(crate) mod text;
