//! Typed configuration for the mobile shell, separate from feature commands.

use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize, specta::Type)]
pub(crate) struct MobileNavigationConfig {
    enabled: bool,
    href: String,
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn mobile_navigation_configure(
    app: tauri::AppHandle,
    input: MobileNavigationConfig,
) -> AppResult<()> {
    #[cfg(target_os = "ios")]
    return tauri_plugin_native_navigation::configure(&app, input)
        .await
        .map_err(|error| AppError::external("navigation:configure", error.to_string()));
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, input);
        Err(AppError::external(
            "navigation:unsupported",
            "Native WebKit navigation requires iOS",
        ))
    }
}
