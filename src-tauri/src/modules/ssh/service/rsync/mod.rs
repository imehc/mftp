//! rsync directory transfer. Desktop only: the helper mode is compiled into
//! the executable and must branch before Tauri initializes.

mod bridge;
mod capability;
mod helper;
mod preview;
mod protocol;
mod spec;
mod stream;
mod sync;

#[cfg(test)]
#[path = "real_sync_tests.rs"]
mod real_sync_tests;
#[cfg(test)]
#[path = "real_test_support.rs"]
mod real_test_support;
#[cfg(test)]
#[path = "real_transfer_tests.rs"]
mod real_transfer_tests;

pub(crate) use capability::RsyncState;
pub(crate) use helper::run_if_requested;
