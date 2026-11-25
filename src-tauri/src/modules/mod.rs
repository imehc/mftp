//! Feature-owned backend modules, migrated incrementally.

#[cfg(any(target_os = "macos", all(desktop, test)))]
pub(crate) mod agent_sessions;
pub(crate) mod ai;
pub(crate) mod diagnostics;
pub(crate) mod filesystem;

pub(crate) mod poetry;
pub(crate) mod speech;

pub(crate) mod ssh;

pub(crate) mod game_room;
pub(crate) mod hosts;
pub(crate) mod keys;
pub(crate) mod lan_transfer;
pub(crate) mod maintenance;
#[cfg(desktop)]
pub(crate) mod mcp;
pub(crate) mod todo;
pub(crate) mod vault;

pub(crate) mod translation;
pub(crate) mod updater;
