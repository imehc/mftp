#[cfg(target_os = "macos")]
use crate::disk_clean::remove::RemoveReport;
use crate::disk_clean::{self, ScanJob, VolumeStat};
#[cfg(target_os = "macos")]
use crate::models::CleanRule;
#[cfg(target_os = "macos")]
use crate::AppState;
#[cfg(target_os = "macos")]
use tauri::State;

#[cfg(target_os = "macos")]
use super::run_blocking;

/// Rules catalog: every rule the frontend can show.
#[cfg(target_os = "macos")]
#[tauri::command]
#[specta::specta]
pub fn disk_clean_rules() -> Vec<CleanRule> {
    disk_clean::rules::catalog()
}

/// Start a rule-driven scan. Returns a job id; progress arrives on
/// `disk-clean://progress`.
#[cfg(target_os = "macos")]
#[tauri::command]
#[specta::specta]
pub fn disk_clean_scan(
    state: State<AppState>,
    app: tauri::AppHandle,
    rule_ids: Vec<String>,
) -> Result<String, String> {
    state
        .disk_clean
        .start_rule_scan(rule_ids, app)
        .map_err(|e| e.to_string())
}

/// Start an arbitrary-directory analysis. The frontend picks the dir via a
/// native dialog and passes the path here.
#[cfg(target_os = "macos")]
#[tauri::command]
#[specta::specta]
pub fn disk_clean_analyze(
    state: State<AppState>,
    app: tauri::AppHandle,
    root: String,
    depth: u32,
) -> Result<String, String> {
    state
        .disk_clean
        .start_analyze(root, depth, app)
        .map_err(|e| e.to_string())
}

/// Poll a job. Fallback for when a progress event is missed.
#[cfg(target_os = "macos")]
#[tauri::command]
#[specta::specta]
pub fn disk_clean_job(state: State<AppState>, job_id: String) -> Result<ScanJob, String> {
    state.disk_clean.job(&job_id).map_err(|e| e.to_string())
}

/// Tell a running job to stop.
#[cfg(target_os = "macos")]
#[tauri::command]
#[specta::specta]
pub fn disk_clean_cancel(state: State<AppState>, job_id: String) -> Result<(), String> {
    state.disk_clean.cancel(&job_id).map_err(|e| e.to_string())
}

/// Delete paths. Every path is gated against the scan's declared roots
/// plus the hard denial list.
#[cfg(target_os = "macos")]
#[tauri::command]
#[specta::specta]
pub async fn disk_clean_remove(
    state: State<'_, AppState>,
    job_id: String,
    paths: Vec<String>,
    permanent: bool,
) -> Result<RemoveReport, String> {
    let allowed_roots = state
        .disk_clean
        .allowed_roots(&job_id)
        .map_err(|e| e.to_string())?;
    // The first trash::delete in a process pays a one-off ~60s macOS
    // authorization cost, and sizing a multi-GB target walks it first. Both
    // would freeze the webview if this ran on the main thread.
    run_blocking(move || {
        disk_clean::remove::remove_paths(paths, permanent, &allowed_roots)
    })
    .await
    .map_err(|e| e.to_string())
}

/// Open the containing folder in Finder and select the target.
#[cfg(target_os = "macos")]
#[tauri::command]
#[specta::specta]
pub fn disk_clean_reveal(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let resolved = std::path::PathBuf::from(&path)
        .canonicalize()
        .map_err(|e| format!("cannot resolve {path}: {e}"))?;
    app.opener()
        .reveal_item_in_dir(&resolved)
        .map_err(|e| format!("failed to reveal: {e}"))
}

/// Total and free space on the volume holding `$HOME`.
#[cfg(target_os = "macos")]
#[tauri::command]
#[specta::specta]
pub fn disk_clean_volume() -> Result<VolumeStat, String> {
    disk_clean::volume_stat().map_err(|e| e.to_string())
}
