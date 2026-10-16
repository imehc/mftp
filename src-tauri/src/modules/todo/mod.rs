pub(crate) mod commands;
pub(crate) mod model;
pub(crate) mod repository;
pub(crate) mod schema;

mod note_assets;
pub(crate) mod note_backup;
pub(crate) mod note_commands;
mod note_image;
pub(crate) mod note_model;
mod note_repository;
pub(crate) mod note_service;

pub(crate) use repository::TodoRepository;

#[cfg(test)]
mod note_tests;

#[cfg(test)]
mod note_backup_tests;

#[cfg(test)]
mod note_inline_tests;

#[cfg(desktop)]
mod note_clipboard;
