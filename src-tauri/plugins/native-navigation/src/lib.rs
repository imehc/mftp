//! iOS WebKit navigation gestures; app route policy stays in the main crate.

use tauri::{Manager, Runtime};

tauri::ios_plugin_binding!(init_plugin_native_navigation);

struct NativeNavigation<R: Runtime>(tauri::plugin::PluginHandle<R>);

pub fn init<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("native-navigation")
        .setup(|app, api| {
            let handle = api.register_ios_plugin(init_plugin_native_navigation)?;
            app.manage(NativeNavigation(handle));
            Ok(())
        })
        .build()
}

pub async fn configure<R: Runtime>(
    app: &tauri::AppHandle<R>,
    config: impl serde::Serialize,
) -> Result<(), tauri::plugin::mobile::PluginInvokeError> {
    app.state::<NativeNavigation<R>>()
        .0
        .run_mobile_plugin_async("configure", config)
        .await
}
