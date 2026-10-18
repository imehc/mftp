#[cfg(target_os = "android")]
use tauri::Manager;
use tauri::Runtime;

#[cfg(target_os = "android")]
struct NativeSpeech<R: Runtime>(tauri::plugin::PluginHandle<R>);

pub fn init<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("native-speech")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            _app.manage(NativeSpeech(_api.register_android_plugin(
                "com.imehc.speech",
                "NativeSpeechPlugin",
            )?));
            Ok(())
        })
        .build()
}

#[cfg(target_os = "android")]
pub async fn call<R: Runtime, T: serde::de::DeserializeOwned>(
    app: &tauri::AppHandle<R>,
    command: &str,
    payload: impl serde::Serialize,
) -> Result<T, &'static str> {
    app.state::<NativeSpeech<R>>()
        .0
        .run_mobile_plugin_async(command, payload)
        .await
        .map_err(|_| "Android speech bridge failed")
}
