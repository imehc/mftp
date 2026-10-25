//! In-app update implementation that only compiles for the Android target.
//!
//! The commands themselves stay available on every platform so the IPC contract
//! and generated bindings are identical; non-Android targets answer with
//! `updater:unsupported` and never reach this module.

use super::commands::AndroidUpdateDownloadInput;
use super::manifest;
use super::model::{
    AndroidUpdateDownload, AndroidUpdateInfo, AndroidUpdateInstall, AndroidUpdateProgress,
};
use crate::app::services::AppServices;
use crate::core::activity::OperationContext;
use crate::error::{AppError, AppResult};
use reqwest::blocking::Client;
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, OnceLock,
};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

const PROGRESS_EVENT: &str = "android-updater://progress";
const MAX_APK_BYTES: u64 = 512 * 1024 * 1024;

static DOWNLOAD_CANCEL: OnceLock<Mutex<Option<Arc<AtomicBool>>>> = OnceLock::new();

fn cancel_slot() -> &'static Mutex<Option<Arc<AtomicBool>>> {
    DOWNLOAD_CANCEL.get_or_init(|| Mutex::new(None))
}

fn client() -> AppResult<Client> {
    Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(30 * 60))
        .user_agent("mftp-android-updater")
        .build()
        .map_err(|error| AppError::external("updater:check_failed", error.to_string()))
}

fn cache_dir<R: tauri::Runtime>(app: &AppHandle<R>) -> AppResult<PathBuf> {
    let path = app
        .path()
        .app_cache_dir()
        .map_err(AppError::from)?
        .join("android-updates");
    fs::create_dir_all(&path).map_err(AppError::from)?;
    Ok(path)
}

fn digest_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub(super) async fn check(app: &AppHandle, state: &AppServices) -> AppResult<AndroidUpdateInfo> {
    let app = app.clone();
    let diagnostics = state.diagnostics.clone();
    let log = diagnostics.begin("updater", "android_check", manifest::URL);
    let mut context = OperationContext::new("updater", "android_check", "release");
    context.operation_id = log.as_ref().map(|log| log.id().to_owned());
    let correlation = context.operation_id.clone();
    state
        .executor
        .blocking_diagnostic(context, log, move || {
            let native = tauri_plugin_android_updater::app_info(&app).map_err(|error| {
                crate::core::diagnostics::context::record(|log| log.transport_error(&error));
                AppError::external("updater:check_failed", error).with_arg("stage", "app_info")
            })?;
            crate::core::diagnostics::context::event(&serde_json::json!({
                "stage": "app_info",
                "currentVersion": native.version_name,
                "currentVersionCode": native.version_code,
            }));
            let remote = manifest::fetch(&diagnostics, correlation.as_deref())?;
            Ok(manifest::update_info(
                remote,
                native.version_name,
                native.version_code,
            ))
        })
        .await
}

pub(super) async fn download(
    app: AppHandle,
    state: &AppServices,
    input: AndroidUpdateDownloadInput,
) -> AppResult<AndroidUpdateDownload> {
    if !input.url.starts_with("https://")
        || input.size == 0
        || input.size > MAX_APK_BYTES
        || input.version_code == 0
        || input.sha256.len() != 64
    {
        return Err(AppError::external(
            "updater:download_failed",
            "Android update download parameters are invalid",
        ));
    }
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut slot = cancel_slot().lock().map_err(|_| {
            AppError::external("updater:download_failed", "Updater state is unavailable")
        })?;
        if slot.is_some() {
            return Err(AppError::external(
                "updater:download_failed",
                "An update download is already running",
            ));
        }
        *slot = Some(cancel.clone());
    }
    // The slot is cleared even when the worker fails, so a retry is never
    // blocked by a stale cancel token.
    let result = state
        .executor
        .blocking(
            OperationContext::new(
                "updater",
                "android_download",
                input.version_code.to_string(),
            ),
            move || download_apk(&app, input, cancel),
        )
        .await;
    if let Ok(mut slot) = cancel_slot().lock() {
        *slot = None;
    }
    result
}

fn download_apk<R: tauri::Runtime>(
    app: &AppHandle<R>,
    input: AndroidUpdateDownloadInput,
    cancel: Arc<AtomicBool>,
) -> AppResult<AndroidUpdateDownload> {
    let dir = cache_dir(app)?;
    let path = dir.join(format!(
        "update-{}-{}.apk",
        input.version_code,
        input.sha256.to_ascii_lowercase()
    ));
    let cleanup = || {
        let _ = fs::remove_file(&path);
    };
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let candidate = entry.path();
            if candidate != path
                && candidate.extension().and_then(|value| value.to_str()) == Some("apk")
            {
                let _ = fs::remove_file(candidate);
            }
        }
    }
    if path.is_file() {
        let metadata = fs::metadata(&path).map_err(AppError::from)?;
        if metadata.len() == input.size {
            let mut cached = File::open(&path).map_err(AppError::from)?;
            let mut hasher = Sha256::new();
            let mut buffer = [0u8; 64 * 1024];
            loop {
                let read = cached.read(&mut buffer).map_err(AppError::from)?;
                if read == 0 {
                    break;
                }
                hasher.update(&buffer[..read]);
            }
            if digest_hex(hasher.finalize().as_ref()).eq_ignore_ascii_case(&input.sha256) {
                let _ = app.emit(
                    PROGRESS_EVENT,
                    AndroidUpdateProgress {
                        phase: "verifying".into(),
                        downloaded: input.size,
                        total: input.size,
                    },
                );
                return Ok(AndroidUpdateDownload {
                    path: path.to_string_lossy().into_owned(),
                    downloaded: input.size,
                    total: input.size,
                    version_code: input.version_code,
                });
            }
        }
        cleanup();
    }
    let result = (|| {
        let mut response = client()?
            .get(&input.url)
            .send()
            .map_err(|error| AppError::external("updater:download_failed", error.to_string()))?;
        if !response.status().is_success() {
            return Err(AppError::external(
                "updater:download_failed",
                format!("APK download returned HTTP {}", response.status()),
            ));
        }
        if response
            .content_length()
            .is_some_and(|length| length > MAX_APK_BYTES)
        {
            return Err(AppError::external(
                "updater:download_failed",
                "APK is too large",
            ));
        }
        let mut file = File::create(&path).map_err(AppError::from)?;
        let mut hasher = Sha256::new();
        let mut downloaded = 0u64;
        let mut buffer = [0u8; 64 * 1024];
        let _ = app.emit(
            PROGRESS_EVENT,
            AndroidUpdateProgress {
                phase: "connecting".into(),
                downloaded: 0,
                total: input.size,
            },
        );
        loop {
            if cancel.load(Ordering::Relaxed) {
                return Err(AppError::external(
                    "updater:download_cancelled",
                    "Android update download was cancelled",
                ));
            }
            let read = response.read(&mut buffer).map_err(|error| {
                AppError::external("updater:download_failed", error.to_string())
            })?;
            if read == 0 {
                break;
            }
            downloaded = downloaded.saturating_add(read as u64);
            if downloaded > input.size || downloaded > MAX_APK_BYTES {
                return Err(AppError::external(
                    "updater:download_failed",
                    "APK size exceeds manifest",
                ));
            }
            file.write_all(&buffer[..read]).map_err(AppError::from)?;
            hasher.update(&buffer[..read]);
            let _ = app.emit(
                PROGRESS_EVENT,
                AndroidUpdateProgress {
                    phase: "downloading".into(),
                    downloaded,
                    total: input.size,
                },
            );
        }
        file.flush().map_err(AppError::from)?;
        if downloaded != input.size {
            return Err(AppError::external(
                "updater:download_failed",
                "APK size does not match manifest",
            ));
        }
        let digest = digest_hex(hasher.finalize().as_ref());
        if !digest.eq_ignore_ascii_case(&input.sha256) {
            return Err(AppError::external(
                "updater:download_failed",
                "APK SHA-256 does not match manifest",
            ));
        }
        let _ = app.emit(
            PROGRESS_EVENT,
            AndroidUpdateProgress {
                phase: "verifying".into(),
                downloaded,
                total: input.size,
            },
        );
        Ok(AndroidUpdateDownload {
            path: path.to_string_lossy().into_owned(),
            downloaded,
            total: input.size,
            version_code: input.version_code,
        })
    })();
    if result.is_err() {
        cleanup();
    }
    result
}

pub(super) fn cancel() -> AppResult<()> {
    let slot = cancel_slot().lock().map_err(|_| {
        AppError::external("updater:download_failed", "Updater state is unavailable")
    })?;
    if let Some(cancel) = slot.as_ref() {
        cancel.store(true, Ordering::Relaxed);
    }
    Ok(())
}

pub(super) fn discard(app: &AppHandle, path: String) -> AppResult<()> {
    let file = std::path::PathBuf::from(path)
        .canonicalize()
        .map_err(AppError::from)?;
    let root = cache_dir(app)?.canonicalize().map_err(AppError::from)?;
    if file.parent() != Some(root.as_path())
        || file.extension().and_then(|value| value.to_str()) != Some("apk")
    {
        return Err(AppError::external(
            "updater:download_failed",
            "Invalid Android update cache path",
        ));
    }
    fs::remove_file(file).map_err(AppError::from)
}

pub(super) fn install(
    app: &AppHandle,
    path: String,
    expected_version_code: u64,
) -> AppResult<AndroidUpdateInstall> {
    tauri_plugin_android_updater::install(app, path, expected_version_code)
        .map(|reply| AndroidUpdateInstall {
            outcome: reply.outcome,
        })
        .map_err(|error| AppError::external("updater:install_failed", error))
}

pub(super) fn open_install_settings(app: &AppHandle) -> AppResult<()> {
    tauri_plugin_android_updater::open_install_settings(app)
        .map(|_| ())
        .map_err(|error| AppError::external("updater:install_failed", error))
}
