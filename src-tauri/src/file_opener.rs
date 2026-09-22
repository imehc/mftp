//! Platform boundary for opening original files with an installed application.

#[cfg(target_os = "android")]
use tauri::Manager;

pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("local-file-opener")
        .setup(|_app, _api| {
            // Android must grant a content URI for app-private files. A raw path
            // cannot be read by another application and must never be copied to cache.
            #[cfg(target_os = "android")]
            _app.manage(_api.register_android_plugin("com.imehc.mftp", "FileOpenerPlugin")?);
            Ok(())
        })
        .build()
}

#[cfg(any(desktop, target_os = "android"))]
pub fn open(app: &tauri::AppHandle, path: &std::path::Path) -> crate::error::AppResult<()> {
    use crate::error::AppError;
    #[cfg(desktop)]
    let result = {
        use tauri_plugin_opener::OpenerExt;
        app.opener()
            .open_path(path.to_string_lossy(), None::<&str>)
            .map_err(|error| error.to_string())
    };
    #[cfg(target_os = "android")]
    let result = app
        .state::<tauri::plugin::PluginHandle<tauri::Wry>>()
        .run_mobile_plugin::<()>("openFile", serde_json::json!({ "path": path }))
        .map_err(|error| error.to_string());
    result.map_err(|error| {
        AppError(format!(
            "Failed to open {} with a system application: {error}",
            path.display()
        ))
    })
}
