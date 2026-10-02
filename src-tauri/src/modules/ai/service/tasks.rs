use std::collections::HashSet;
use std::sync::Arc;

use parking_lot::Mutex;

use crate::core::operations::{OperationLease, Operations};
use crate::error::{AppError, AppResult, CustomErrorCode};

const POETRY_TRANSLATION_STREAM_PREFIX: &str = "ai://poetry-translation/";

pub fn poetry_translation_stream_event(request_id: &str) -> AppResult<String> {
    uuid::Uuid::parse_str(request_id)
        .map_err(|_| AppError::custom(CustomErrorCode::AiStreamRequestIdInvalid))?;
    Ok(format!("{POETRY_TRANSLATION_STREAM_PREFIX}{request_id}"))
}

pub struct AiTaskManager {
    operations: Arc<Operations>,
    active: Mutex<HashSet<String>>,
}

impl AiTaskManager {
    pub(crate) fn new(operations: Arc<Operations>) -> Self {
        Self {
            operations,
            active: Mutex::new(HashSet::new()),
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

#[cfg(test)]
#[path = "tasks_tests.rs"]
mod tests;
