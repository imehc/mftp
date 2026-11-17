//! Presentation-only translations compiled from this crate's own catalogs.

use std::borrow::Cow;

/// Supported, complete application locales.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Locale {
    /// Simplified Chinese.
    Chinese,
    /// English, also the fallback for unsupported system languages.
    English,
}

impl Locale {
    /// Resolves an operating system language without guessing unsupported locales.
    pub fn from_system(language: &str) -> Self {
        let language = language.replace('_', "-").to_ascii_lowercase();
        if matches!(language.as_str(), "zh" | "zh-cn" | "zh-sg" | "zh-hans")
            || language.starts_with("zh-hans-")
        {
            Self::Chinese
        } else {
            Self::English
        }
    }

    /// Locale identifier shared with GPUI Kit's internal components.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Chinese => "zh-CN",
            Self::English => "en",
        }
    }
}

/// A language preference, independent of either UI framework's global state.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LanguagePreference {
    /// Use the supported system locale or English fallback.
    #[default]
    System,
    /// Always use Simplified Chinese.
    Chinese,
    /// Always use English.
    English,
}

impl LanguagePreference {
    /// Resolve the preference using a supplied system locale.
    pub fn resolve(self, system: Locale) -> Locale {
        match self {
            Self::System => system,
            Self::Chinese => Locale::Chinese,
            Self::English => Locale::English,
        }
    }

    /// Display each language by its own name in every interface language.
    pub fn label(self, locale: Locale) -> Cow<'static, str> {
        match self {
            Self::System => text("settings.system", locale),
            Self::Chinese => text("languages.chinese", Locale::Chinese),
            Self::English => text("languages.english", Locale::English),
        }
    }
}

/// Translate using an explicit locale so rendering never depends on test order.
pub fn text(key: &'static str, locale: Locale) -> Cow<'static, str> {
    rust_i18n::t!(key, locale = locale.as_str())
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
