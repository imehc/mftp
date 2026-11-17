//! Independent native desktop presentation and platform entry points.

pub mod app;
pub mod components;
pub mod features;
pub mod i18n;
pub mod platform;
pub mod preferences;
pub(crate) mod resources;

rust_i18n::i18n!("locales", fallback = "en");

#[cfg(test)]
pub(crate) static UI_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
