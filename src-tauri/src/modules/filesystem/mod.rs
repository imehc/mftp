//! Runtime grants for paths the user picked in a native dialog.
//!
//! The webview only touches files it obtained from a system dialog, but the
//! static `fs:scope` in the capability stops at the well-known roots, so an
//! external volume, a network share or a temporary directory is rejected as
//! `PathForbidden` right after the user explicitly chose it. Granting the exact
//! picked path keeps the dialog authoritative instead of widening the static
//! scope, and the grant lives in memory for the current session only.

use std::path::Path;

use tauri::{AppHandle, Runtime};
use tauri_plugin_fs::FsExt;

#[cfg(test)]
mod tests;

/// Allow the fs plugin to operate on one picked path for this session.
///
/// A failure is not fatal: the static scope may already cover the path, and any
/// remaining problem must surface as the plugin's own `PathForbidden` when the
/// operation actually runs.
pub(crate) fn allow_path<R: Runtime>(app: &AppHandle<R>, path: &str) {
    // A relative path would resolve against the process working directory,
    // which no dialog ever returns.
    if path.is_empty() || !Path::new(path).is_absolute() {
        return;
    }
    let Some(scope) = app.try_fs_scope() else {
        return;
    };
    // The scope stores glob patterns; a pick with glob metacharacters cannot be
    // represented and keeps relying on the static scope.
    let _ = scope.allow_file(path);
}

#[tauri::command]
#[specta::specta]
pub fn filesystem_allow_path(app: AppHandle, path: String) {
    allow_path(&app, &path);
}
