//! Stored appearance and language choices, independent from view ownership.

use crate::i18n::LanguagePreference;
use gpui_kit::{WindowAppearance, component::ThemeMode};
use serde::{Deserialize, Serialize};

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AppearancePreference {
    #[default]
    System,
    Light,
    Dark,
}

impl AppearancePreference {
    pub fn window_override(self) -> Option<WindowAppearance> {
        match self {
            Self::System => None,
            Self::Light => Some(WindowAppearance::Light),
            Self::Dark => Some(WindowAppearance::Dark),
        }
    }

    pub fn resolve(self, system: WindowAppearance) -> ThemeMode {
        match self {
            Self::System => system.into(),
            Self::Light => ThemeMode::Light,
            Self::Dark => ThemeMode::Dark,
        }
    }

    pub(crate) fn label_key(self) -> &'static str {
        match self {
            Self::System => "settings.system",
            Self::Light => "settings.light",
            Self::Dark => "settings.dark",
        }
    }

    pub(crate) fn control_id(self) -> &'static str {
        match self {
            Self::System => "appearance-system",
            Self::Light => "appearance-light",
            Self::Dark => "appearance-dark",
        }
    }
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[non_exhaustive]
pub struct Preferences {
    language: LanguagePreference,
    appearance: AppearancePreference,
}

impl Preferences {
    pub fn new(language: LanguagePreference, appearance: AppearancePreference) -> Self {
        Self {
            language,
            appearance,
        }
    }

    pub fn language(self) -> LanguagePreference {
        self.language
    }

    pub fn appearance(self) -> AppearancePreference {
        self.appearance
    }
}
