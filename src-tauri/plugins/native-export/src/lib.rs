use serde::{Deserialize, Serialize};
#[cfg(mobile)]
use tauri::Manager;
use tauri::{AppHandle, Runtime};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_native_export);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub id: String,
    pub path: String,
    pub mime: String,
    pub action: String,
}

#[derive(Deserialize)]
pub struct Reply {
    pub outcome: String,
}

#[cfg(mobile)]
struct NativeExport<R: Runtime>(tauri::plugin::PluginHandle<R>);

pub fn init<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("native-export")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            let handle = _api.register_android_plugin("com.imehc.export", "NativeExportPlugin")?;
            #[cfg(target_os = "ios")]
            let handle = _api.register_ios_plugin(init_plugin_native_export)?;
            #[cfg(mobile)]
            _app.manage(NativeExport(handle));
            Ok(())
        })
        .build()
}

pub fn present<R: Runtime>(_app: &AppHandle<R>, _request: Request) -> Result<Reply, &'static str> {
    #[cfg(mobile)]
    return _app
        .state::<NativeExport<R>>()
        .0
        .run_mobile_plugin("present", _request)
        .map_err(|_| "Native export failed");
    #[cfg(not(mobile))]
    Err("Native export is only available on mobile")
}

pub fn cancel<R: Runtime>(_app: &AppHandle<R>, _id: String) -> Result<(), &'static str> {
    #[cfg(mobile)]
    return _app
        .state::<NativeExport<R>>()
        .0
        .run_mobile_plugin("cancel", serde_json::json!({"id": _id}))
        .map_err(|_| "Native export cancellation failed");
    #[cfg(not(mobile))]
    Ok(())
}
