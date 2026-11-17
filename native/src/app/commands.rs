//! Native application commands share the workspace's guarded close lifecycle.

use crate::i18n::{Locale, text};
use gpui_kit::{App, KeyBinding, Menu, MenuItem};

gpui_kit::actions!(native_app, [Quit]);

pub(super) fn bind_keys(cx: &mut App) {
    let key = if cfg!(target_os = "macos") {
        "cmd-q"
    } else {
        "ctrl-q"
    };
    cx.bind_keys([KeyBinding::new(key, Quit, None)]);
}

pub(super) fn update_menu(locale: Locale, cx: &App) {
    // Native menu shortcuts are resolved when set_menus runs, after key binding.
    cx.set_menus([Menu::new("MFTP Native").items([MenuItem::action(
        text("app.quit", locale).into_owned(),
        Quit,
    )])]);
}
