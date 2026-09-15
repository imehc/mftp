//! Shared AI connection primitives. IPC exposes only bounded application
//! tasks; credentials and provider requests stay behind this module.

mod client;
mod credentials;
mod model;
mod url;

pub use client::test_connection;
pub use credentials::{
    clear_api_key, clear_api_key_for_reset, has_api_key, read_api_key, save_api_key,
};
pub use model::{AiConnection, AiConnectionConfig, AiConnectionInput};
pub use url::validate_connection;
