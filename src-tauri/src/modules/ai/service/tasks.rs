use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use parking_lot::Mutex;
use tokio::sync::mpsc::{self, Receiver, Sender};

use crate::core::operations::{OperationLease, Operations};
use crate::error::{AppError, AppResult, CustomErrorCode};
use crate::modules::ai::completion::AiControlMessage;

const POETRY_TRANSLATION_STREAM_PREFIX: &str = "ai://poetry-translation/";

pub fn poetry_translation_stream_event(request_id: &str) -> AppResult<String> {
    uuid::Uuid::parse_str(request_id)
        .map_err(|_| AppError::custom(CustomErrorCode::AiStreamRequestIdInvalid))?;
    Ok(format!("{POETRY_TRANSLATION_STREAM_PREFIX}{request_id}"))
}

pub struct AiTaskManager {
    operations: Arc<Operations>,
    active: Mutex<HashSet<String>>,
    controls: Mutex<HashMap<String, Sender<AiControlMessage>>>,
}

impl AiTaskManager {
    pub(crate) fn new(operations: Arc<Operations>) -> Self {
        Self {
            operations,
            active: Mutex::new(HashSet::new()),
            controls: Mutex::new(HashMap::new()),
        }
    }

    /// The lease keeps in-flight generations visible to maintenance draining
    /// and shutdown; it releases with the guard when the future completes or
    /// is dropped (dropping the future also aborts the provider stream).
    pub fn begin(self: &Arc<Self>, key: String) -> AppResult<AiTaskGuard> {
        let lease = self.operations.begin()?;
        {
            let mut active = self.active.lock();
            if !active.insert(key.clone()) {
                return Err(AppError::custom(CustomErrorCode::AiTaskAlreadyRunning));
            }
        }
        Ok(AiTaskGuard {
            manager: self.clone(),
            key,
            _lease: lease,
        })
    }

    /// Register the cancellation channel for one request id. The entry lives as
    /// long as the returned session, so a cancel arriving after completion is a
    /// harmless miss instead of an error.
    pub fn control(self: &Arc<Self>, request_id: &str) -> AppResult<AiControlSession> {
        let (sender, receiver) = mpsc::channel(4);
        if self
            .controls
            .lock()
            .insert(request_id.to_string(), sender)
            .is_some()
        {
            return Err(AppError::custom(CustomErrorCode::AiTaskAlreadyRunning));
        }
        Ok(AiControlSession {
            manager: self.clone(),
            request_id: request_id.to_string(),
            receiver,
        })
    }

    /// Deliver a cancel to the running request. Returns whether one was waiting;
    /// a missing entry is a finished or rejected request, not an application
    /// error, so callers can ignore the boolean.
    pub fn cancel(&self, request_id: &str) -> bool {
        let controls = self.controls.lock();
        controls
            .get(request_id)
            .is_some_and(|sender| sender.try_send(AiControlMessage::Cancel).is_ok())
    }
}

pub struct AiTaskGuard {
    manager: Arc<AiTaskManager>,
    key: String,
    _lease: OperationLease,
}

impl Drop for AiTaskGuard {
    fn drop(&mut self) {
        self.manager.active.lock().remove(&self.key);
    }
}

/// Owns one request's control channel; the provider stream watches it and
/// stops with `ai:cancelled` the moment a cancel arrives.
pub struct AiControlSession {
    manager: Arc<AiTaskManager>,
    request_id: String,
    receiver: Receiver<AiControlMessage>,
}

impl AiControlSession {
    pub fn receiver(&mut self) -> &mut Receiver<AiControlMessage> {
        &mut self.receiver
    }
}

impl Drop for AiControlSession {
    fn drop(&mut self) {
        self.manager.controls.lock().remove(&self.request_id);
    }
}

#[cfg(test)]
#[path = "tasks_tests.rs"]
mod tests;
