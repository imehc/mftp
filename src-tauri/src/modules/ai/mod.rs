//! Shared AI connection primitives. IPC exposes only bounded application
//! tasks; credentials and provider requests stay behind this module.
//!
//! The service layer is a generic, size-bounded text pipeline: the provider
//! request carries instructions assembled by the calling feature module and
//! the response text is returned unparsed. Domain prompts and result
//! interpretation belong to the callers (e.g. poetry translation).

mod legacy_schema;
mod model;
mod ports;
mod repository;
pub(crate) mod schema;
mod service;

pub use model::AiConnectionConfig;
pub(crate) use ports::AiCredentials;
pub(crate) use repository::AiRepository;
pub(crate) use service::{
    generate_text, poetry_translation_stream_event, AiConfigurationService, AiTaskManager,
    AiTextRequest,
};

pub(crate) mod configuration;
#[cfg(test)]
pub(crate) use service::AiConnectionInput;
