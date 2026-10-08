use serde::Deserialize;
#[cfg(mobile)]
use serde::Serialize;
#[cfg(mobile)]
use tauri::Manager;
use tauri::{AppHandle, Runtime};
#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_native_viewer);

#[derive(Deserialize)]
pub struct Incoming {
    pub path: String,
    pub name: String,
}
#[derive(Deserialize)]
pub struct Snapshot {
    pub files: Vec<Incoming>,
    pub failed: bool,
    pub thermal: String,
}
#[cfg(mobile)]
#[derive(Serialize)]
struct Request {
    urls: Vec<String>,
}
#[cfg(mobile)]
struct NativeViewer<R: Runtime>(tauri::plugin::PluginHandle<R>);

pub fn init<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("native-viewer")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            let handle = _api.register_android_plugin("com.imehc.viewer", "NativeViewerPlugin")?;
            #[cfg(target_os = "ios")]
            let handle = _api.register_ios_plugin(init_plugin_native_viewer)?;
            #[cfg(mobile)]
            _app.manage(NativeViewer(handle));
            Ok(())
        })
        .build()
}
pub fn poll<R: Runtime>(_app: &AppHandle<R>, _urls: Vec<String>) -> Result<Snapshot, &'static str> {
    #[cfg(mobile)]
    return _app
        .state::<NativeViewer<R>>()
        .0
        .run_mobile_plugin("poll", Request { urls: _urls })
        .map_err(|_| "Native viewer polling failed");
    #[cfg(not(mobile))]
    Ok(Snapshot {
        files: vec![],
        failed: false,
        thermal: "unknown".into(),
    })
}
