//! Shared AI connection primitives. IPC exposes only bounded application
//! tasks; credentials and provider requests stay behind this module.
//!
//! The service layer normalizes bounded text and reasoning events with shared
//! deadlines and cancellation. Calling features own prompts, domain schemas,
//! result interpretation, and persistence (e.g. poetry translation).

pub(crate) mod completion;
mod legacy_schema;
mod model;
mod ports;
mod repository;
pub(crate) mod schema;
mod service;

pub use model::{AiConnectionConfig, AiProtocol};
pub(crate) use ports::AiCredentials;
pub(crate) use repository::AiRepository;
pub(crate) use service::{
    generate_text, poetry_translation_stream_event, AiConfigurationService, AiTaskManager,
    AiTextRequest,
};

pub(crate) mod configuration;
#[cfg(test)]
pub(crate) use service::AiConnectionInput;
