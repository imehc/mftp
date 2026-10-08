use crate::app::services::AppServices;
#[cfg(mobile)]
use crate::error::AppError;
use crate::error::AppResult;
use parking_lot::Mutex;
use serde::Serialize;
use specta::Type;
use std::collections::VecDeque;
#[cfg(desktop)]
use std::path::Path;
#[cfg(desktop)]
use tauri::Manager;
use tauri::State;

#[derive(Default)]
pub(crate) struct ModelOpenInbox(Mutex<(VecDeque<String>, bool)>);
impl ModelOpenInbox {
    pub(crate) fn push(&self, value: String) {
        let mut queue = self.0.lock();
        if value.len() > 8192 || queue.0.len() >= 8 {
            queue.1 = true;
            return;
        }
        queue.0.push_back(value);
    }
    fn drain(&self) -> (Vec<String>, bool) {
        let mut queue = self.0.lock();
        let result = (queue.0.drain(..).collect(), queue.1);
        queue.1 = false;
        result
    }
}
#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ModelOpenRequest {
    pub id: String,
    pub path: String,
    pub name: String,
}
#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ModelThermalState {
    Unknown,
    Nominal,
    Fair,
    Serious,
    Critical,
}
#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ModelSystemSnapshot {
    pub files: Vec<ModelOpenRequest>,
    pub failed: bool,
    pub thermal: ModelThermalState,
}

#[cfg(desktop)]
pub(crate) fn enqueue_arguments(app: &tauri::AppHandle, args: Vec<String>, cwd: &Path) {
    let inbox = app.state::<std::sync::Arc<ModelOpenInbox>>();
    for argument in args.into_iter().skip(1) {
        if argument.starts_with('-') {
            continue;
        }
        if argument.contains("://") {
            inbox.push(argument);
            continue;
        }
        let path = Path::new(&argument);
        if path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("glb"))
        {
            let path = if path.is_absolute() {
                path.to_path_buf()
            } else {
                cwd.join(path)
            };
            inbox.push(path.to_string_lossy().into_owned());
        }
    }
}
fn local_request(value: String) -> Option<ModelOpenRequest> {
    let path = if value.starts_with("file:") {
        url::Url::parse(&value).ok()?.to_file_path().ok()?
    } else {
        // Reject remote schemes and relative paths received from event adapters.
        let path = std::path::PathBuf::from(value);
        if !path.is_absolute() {
            return None;
        }
        path
    };
    if !path.extension()?.eq_ignore_ascii_case("glb") {
        return None;
    }
    let name = path.file_name()?.to_str()?.to_owned();
    Some(ModelOpenRequest {
        id: uuid::Uuid::new_v4().to_string(),
        path: path.to_str()?.into(),
        name,
    })
}

fn thermal(value: &str) -> ModelThermalState {
    match value {
        "nominal" => ModelThermalState::Nominal,
        "fair" => ModelThermalState::Fair,
        "serious" => ModelThermalState::Serious,
        "critical" => ModelThermalState::Critical,
        _ => ModelThermalState::Unknown,
    }
}

#[tauri::command]
#[specta::specta]
pub async fn model_system_poll(
    app: tauri::AppHandle,
    state: State<'_, AppServices>,
) -> AppResult<ModelSystemSnapshot> {
    let inbox = state.model_inbox.clone();
    state
        .executor
        .blocking_unlogged(move || {
            let (values, mut failed) = inbox.drain();
            #[cfg(mobile)]
            let (files, thermal) = {
                let snapshot = tauri_plugin_native_viewer::poll(&app, values).map_err(|_| {
                    AppError::external("model:system_open", "Native model import failed")
                })?;
                failed |= snapshot.failed;
                let mut files = Vec::new();
                for file in snapshot.files {
                    if let Some(mut request) = local_request(file.path) {
                        request.name = file.name;
                        files.push(request);
                    } else {
                        failed = true;
                    }
                }
                let thermal = thermal(&snapshot.thermal);
                (files, thermal)
            };
            #[cfg(not(mobile))]
            let (files, thermal) = {
                let _ = app;
                let files = values
                    .into_iter()
                    .filter_map(|value| {
                        let request = local_request(value);
                        failed |= request.is_none();
                        request
                    })
                    .collect();
                (files, thermal("unknown"))
            };
            Ok(ModelSystemSnapshot {
                files,
                failed,
                thermal,
            })
        })
        .await
}

#[cfg(test)]
#[path = "system_tests.rs"]
mod tests;
