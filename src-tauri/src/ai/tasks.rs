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
mod tests {
    use super::*;

    #[test]
    fn rejects_duplicate_tasks_until_the_guard_is_dropped() {
        let manager = Arc::new(AiTaskManager::default());
        let guard = manager.begin("poem:literal".into()).unwrap();
        assert!(manager.begin("poem:literal".into()).is_err());
        drop(guard);
        assert!(manager.begin("poem:literal".into()).is_ok());
    }

    #[test]
    fn stream_event_accepts_only_uuid_request_ids() {
        let id = "67d497e8-4ed9-4e49-b03e-bfd738654501";
        assert_eq!(
            poetry_translation_stream_event(id).unwrap(),
            format!("ai://poetry-translation/{id}")
        );
        assert!(poetry_translation_stream_event("../other-event").is_err());
    }
}
