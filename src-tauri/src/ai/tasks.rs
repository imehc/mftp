use std::collections::HashSet;
use std::sync::Arc;

use parking_lot::Mutex;

use crate::error::{AppError, AppResult};

const POETRY_TRANSLATION_STREAM_PREFIX: &str = "ai://poetry-translation/";

pub fn poetry_translation_stream_event(request_id: &str) -> AppResult<String> {
    uuid::Uuid::parse_str(request_id)
        .map_err(|_| AppError("Invalid AI stream request id".into()))?;
    Ok(format!("{POETRY_TRANSLATION_STREAM_PREFIX}{request_id}"))
}

#[derive(Default)]
pub struct AiTaskManager {
    active: Mutex<HashSet<String>>,
}

impl AiTaskManager {
    pub fn begin(self: &Arc<Self>, key: String) -> AppResult<AiTaskGuard> {
        let mut active = self.active.lock();
        if !active.insert(key.clone()) {
            return Err(AppError("The same AI task is already running".into()));
        }
        Ok(AiTaskGuard {
            manager: self.clone(),
            key,
        })
    }
}

pub struct AiTaskGuard {
    manager: Arc<AiTaskManager>,
    key: String,
}

impl Drop for AiTaskGuard {
    fn drop(&mut self) {
        self.manager.active.lock().remove(&self.key);
    }
}

#[cfg(test)]
#[path = "tasks_tests.rs"]
mod tests;
