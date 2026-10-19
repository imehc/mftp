use super::{catalog, files, model::*};
use crate::core::operations::{OperationLease, Operations};
use crate::error::{AppError, AppResult, CustomErrorCode};
use parking_lot::{Condvar, Mutex};
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc,
};
use std::time::Duration;

/// Loaded weights stay in memory this long after the last translation.
const IDLE_RELEASE: Duration = Duration::from_secs(180);

struct Active {
    owner: String,
    cancel: Arc<AtomicBool>,
    task: TranslationTask,
}

pub(crate) struct TranslationService {
    pub(super) root: PathBuf,
    operations: Arc<Operations>,
    active: Mutex<Option<Active>>,
    idle: Condvar,
    /// Bumped per translation so only the latest idle timer frees the engine.
    uses: AtomicU64,
}

pub(super) struct Worker {
    service: Arc<TranslationService>,
    pub cancel: Arc<AtomicBool>,
    pub id: String,
    _lease: OperationLease,
}

impl Drop for Worker {
    fn drop(&mut self) {
        let mut active = self.service.active.lock();
        if active
            .as_ref()
            .is_some_and(|job| job.task.request_id == self.id)
        {
            *active = None;
            self.service.idle.notify_all();
        }
    }
}

impl Worker {
    pub fn progress(&self, phase: TranslationPhase, completed: u64) {
        let mut active = self.service.active.lock();
        if let Some(active) = active.as_mut().filter(|job| job.task.request_id == self.id) {
            if !active.cancel.load(Ordering::Acquire) {
                active.task.phase = phase;
            }
            active.task.completed_bytes = completed as f64;
        }
    }
}

impl TranslationService {
    pub(crate) fn model_root(data: &std::path::Path) -> PathBuf {
        // Tauri's Android data path is Context.dataDir; Android automatically
        // excludes the no_backup child from cloud and device-transfer backups.
        #[cfg(target_os = "android")]
        let data = data.join("no_backup");
        data.join("translation-models")
    }

    pub(crate) fn clear(&self) -> AppResult<()> {
        let active = self.active.lock();
        if active.is_some() {
            return Err(AppError::custom(CustomErrorCode::TranslationBusy));
        }
        mftp_translation_engine::release();
        drop(active);
        match std::fs::remove_dir_all(&self.root) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.into()),
        }
    }

    pub(crate) fn new(root: PathBuf, operations: Arc<Operations>) -> Self {
        Self {
            root,
            operations,
            active: Mutex::new(None),
            idle: Condvar::new(),
            uses: AtomicU64::new(0),
        }
    }

    pub(super) fn begin(
        self: &Arc<Self>,
        owner: String,
        id: String,
        model_id: &str,
    ) -> AppResult<Worker> {
        let model = catalog::find(model_id)?;
        if uuid::Uuid::parse_str(&id).is_err() {
            return Err(AppError::custom(CustomErrorCode::TranslationInputInvalid));
        }
        let lease = self.operations.begin()?;
        let mut active = self.active.lock();
        if active.is_some() {
            return Err(AppError::custom(CustomErrorCode::TranslationBusy));
        }
        let cancel = Arc::new(AtomicBool::new(false));
        *active = Some(Active {
            owner,
            cancel: cancel.clone(),
            task: TranslationTask {
                request_id: id.clone(),
                model_id: model.id.into(),
                phase: TranslationPhase::Preparing,
                completed_bytes: 0.0,
                total_bytes: model.bytes as f64,
            },
        });
        Ok(Worker {
            service: self.clone(),
            cancel,
            id,
            _lease: lease,
        })
    }

    pub(crate) fn cancel(&self, owner: &str, id: &str) {
        if let Some(active) = self
            .active
            .lock()
            .as_mut()
            .filter(|job| job.owner == owner && job.task.request_id == id)
        {
            active.cancel.store(true, Ordering::Release);
            active.task.phase = TranslationPhase::Stopping;
        }
    }

    pub(crate) fn cancel_owner(&self, owner: &str) {
        if let Some(active) = self.active.lock().as_mut().filter(|job| job.owner == owner) {
            active.cancel.store(true, Ordering::Release);
            active.task.phase = TranslationPhase::Stopping;
        }
    }

    pub(crate) fn is_busy(&self) -> bool {
        self.active.lock().is_some()
    }

    pub(crate) fn shutdown(&self) {
        let mut active = self.active.lock();
        if let Some(active) = active.as_mut() {
            active.cancel.store(true, Ordering::Release);
            active.task.phase = TranslationPhase::Stopping;
        }
        while active.is_some() {
            self.idle.wait(&mut active);
        }
        mftp_translation_engine::release();
    }

    fn schedule_release(self: Arc<Self>) {
        let generation = self.uses.fetch_add(1, Ordering::AcqRel) + 1;
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(IDLE_RELEASE).await;
            // Holding `active` keeps a new request from starting while weights are freed.
            let active = self.active.lock();
            if active.is_none() && self.uses.load(Ordering::Acquire) == generation {
                mftp_translation_engine::release();
            }
        });
    }

    pub(super) fn snapshot(&self) -> AppResult<TranslationSnapshot> {
        let selected_id = files::selected(&self.root)?;
        let models = catalog::available()
            .map(|spec| {
                let installed =
                    files::size(&files::model_path(&self.root, spec))? == Some(spec.bytes);
                let partial = files::size(&files::partial_path(&self.root, spec))?.unwrap_or(0);
                Ok(spec.view(installed, partial))
            })
            .collect::<AppResult<Vec<_>>>()?;
        Ok(TranslationSnapshot {
            models,
            selected_id,
            task: self
                .active
                .lock()
                .as_ref()
                .map(|active| active.task.clone()),
        })
    }

    pub(super) fn generate(
        &self,
        worker: &Worker,
        request: TranslationRequest,
        channel: tauri::ipc::Channel<TranslationOutput>,
    ) -> AppResult<String> {
        if request.text.trim().is_empty()
            || request.text.len() > 32_768
            || request.text.contains('\0')
        {
            return Err(AppError::custom(CustomErrorCode::TranslationInputInvalid));
        }
        let model = catalog::find(&request.model_id)?;
        let path = files::model_path(&self.root, model);
        if files::size(&path)?.is_none() {
            return Err(AppError::custom(CustomErrorCode::TranslationNotInstalled));
        }
        let prompt = model.profile.prompt(
            &request.source_language,
            &request.target_language,
            &request.text,
        )?;
        worker.progress(TranslationPhase::Verifying, 0);
        // The legacy tensor remapping is enabled only after checking this exact official artifact.
        files::verify_once(&path, model, &worker.cancel)?;
        worker.progress(TranslationPhase::Loading, model.bytes);
        let mut pending = Vec::new();
        let mut sequence = 0;
        let mut output_error = None;
        let mut complete_text = String::new();
        let result = mftp_translation_engine::translate(
            &path,
            &prompt,
            &model.profile.parameters(model.legacy_stq),
            &worker.cancel,
            |chunk| {
                worker.progress(TranslationPhase::Generating, model.bytes);
                pending.extend_from_slice(chunk);
                let count = match std::str::from_utf8(&pending) {
                    Ok(text) => text.len(),
                    Err(error) if error.error_len().is_none() => error.valid_up_to(),
                    Err(_) => {
                        output_error = Some(AppError::custom(CustomErrorCode::TranslationEngine));
                        return false;
                    }
                };
                if count == 0 {
                    return true;
                }
                let text = String::from_utf8_lossy(&pending[..count]).into_owned();
                complete_text.push_str(&text);
                pending.drain(..count);
                sequence += 1;
                match channel.send(TranslationOutput {
                    request_id: worker.id.clone(),
                    sequence,
                    text,
                }) {
                    Ok(()) => true,
                    Err(error) => {
                        output_error = Some(error.into());
                        false
                    }
                }
            },
        );
        worker.service.clone().schedule_release();
        if let Some(error) = output_error {
            return Err(error);
        }
        if result.is_ok() && !pending.is_empty() {
            return Err(AppError::custom(CustomErrorCode::TranslationEngine));
        }
        result.map_err(|failure| {
            use mftp_translation_engine::Failure;
            match failure {
                Failure::Cancelled => AppError::custom(CustomErrorCode::TranslationCancelled),
                Failure::InputLimit => AppError::custom(CustomErrorCode::TranslationInputLimit),
                Failure::OutputLimit => AppError::custom(CustomErrorCode::TranslationOutputLimit),
                Failure::Engine(error) => {
                    AppError::custom(CustomErrorCode::TranslationEngine).context(error)
                }
            }
        })?;
        Ok(complete_text)
    }
}
