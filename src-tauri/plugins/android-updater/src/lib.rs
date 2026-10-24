use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

#[cfg(target_os = "android")]
use tauri::Manager;

#[cfg(target_os = "android")]
#[derive(Debug, Serialize, Deserialize)]
struct InstallArgs {
    path: String,
    expected_version_code: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AndroidAppInfo {
    pub package_name: String,
    pub version_name: String,
    pub version_code: u64,
    pub can_request_package_installs: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallReply {
    pub outcome: String,
}

#[cfg(target_os = "android")]
struct AndroidUpdater<R: Runtime>(tauri::plugin::PluginHandle<R>);

pub fn init<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("android-updater")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                let handle = api
                    .register_android_plugin("com.imehc.androidupdater", "AndroidUpdaterPlugin")?;
                app.manage(AndroidUpdater(handle));
            }
            Ok(())
        })
        .build()
}

pub fn app_info<R: Runtime>(app: &AppHandle<R>) -> Result<AndroidAppInfo, String> {
    #[cfg(target_os = "android")]
    return app
        .state::<AndroidUpdater<R>>()
        .0
        .run_mobile_plugin("info", serde_json::json!({}))
        .map_err(|error| error.to_string());
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err("Android updater is only available on Android".into())
    }
}

pub fn install<R: Runtime>(
    app: &AppHandle<R>,
    path: String,
    expected_version_code: u64,
) -> Result<InstallReply, String> {
    #[cfg(target_os = "android")]
    return app
        .state::<AndroidUpdater<R>>()
        .0
        .run_mobile_plugin(
            "install",
            InstallArgs {
                path,
                expected_version_code,
            },
        )
        .map_err(|error| error.to_string());
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, path, expected_version_code);
        Err("Android updater is only available on Android".into())
    }
}

pub fn open_install_settings<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    #[cfg(target_os = "android")]
    return app
        .state::<AndroidUpdater<R>>()
        .0
        .run_mobile_plugin("openInstallSettings", serde_json::json!({}))
        .map_err(|error| error.to_string());
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err("Android updater is only available on Android".into())
    }
}
