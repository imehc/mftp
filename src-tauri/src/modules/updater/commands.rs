use super::model::{AndroidUpdateDownload, AndroidUpdateInfo, AndroidUpdateInstall};
use crate::app::services::AppServices;
use crate::error::AppResult;
use serde::Deserialize;
use tauri::{AppHandle, State};

#[cfg(target_os = "android")]
use super::android;
#[cfg(not(target_os = "android"))]
use crate::error::AppError;

#[cfg(not(target_os = "android"))]
fn unsupported<T>() -> AppResult<T> {
    Err(AppError::external(
        "updater:unsupported",
        "Android updater is only available on Android",
    ))
}

/// Kept outside the platform module so the IPC contract, and therefore the
/// generated TypeScript bindings, stay identical on every target.
#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AndroidUpdateDownloadInput {
    pub url: String,
    pub size: u64,
    pub sha256: String,
    pub version_code: u64,
}

#[tauri::command]
#[specta::specta]
pub async fn android_update_check(
    app: AppHandle,
    state: State<'_, AppServices>,
) -> AppResult<AndroidUpdateInfo> {
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, state);
        unsupported()
    }

    #[cfg(target_os = "android")]
    android::check(&app, state.inner()).await
}

#[tauri::command]
#[specta::specta]
pub async fn android_update_download(
    app: AppHandle,
    state: State<'_, AppServices>,
    input: AndroidUpdateDownloadInput,
) -> AppResult<AndroidUpdateDownload> {
    #[cfg(not(target_os = "android"))]
    {
        // Reading the fields keeps the shared contract free of dead-code noise.
        let _ = (
            &input.url,
            &input.size,
            &input.sha256,
            &input.version_code,
            app,
            state,
        );
        unsupported()
    }

    #[cfg(target_os = "android")]
    android::download(app, state.inner(), input).await
}

#[tauri::command]
#[specta::specta]
pub async fn android_update_cancel() -> AppResult<()> {
    #[cfg(not(target_os = "android"))]
    return unsupported();

    #[cfg(target_os = "android")]
    android::cancel()
}

#[tauri::command]
#[specta::specta]
pub async fn android_update_discard(app: AppHandle, path: String) -> AppResult<()> {
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, path);
        unsupported()
    }

    #[cfg(target_os = "android")]
    android::discard(&app, path)
}

#[tauri::command]
#[specta::specta]
pub async fn android_update_install(
    app: AppHandle,
    path: String,
    expected_version_code: u64,
) -> AppResult<AndroidUpdateInstall> {
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, path, expected_version_code);
        unsupported()
    }

    #[cfg(target_os = "android")]
    android::install(&app, path, expected_version_code)
}

#[tauri::command]
#[specta::specta]
pub async fn android_update_open_install_settings(app: AppHandle) -> AppResult<()> {
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        unsupported()
    }

    #[cfg(target_os = "android")]
    android::open_install_settings(&app)
}
