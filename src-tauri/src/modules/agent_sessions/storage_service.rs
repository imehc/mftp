use std::sync::atomic::AtomicBool;

use super::model::AgentSessionStorage;
use super::service::{AgentSessionService, Entry};
use super::storage::{self, StorageResource};
use crate::error::{AppError, AppResult, CustomErrorCode};

pub(super) fn resources(entries: &[Entry]) -> Vec<StorageResource> {
    entries
        .iter()
        .map(|entry| StorageResource {
            summary: entry.summary.clone(),
            resource: entry.resource.clone(),
            complete: entry.complete,
        })
        .collect()
}

impl AgentSessionService {
    pub(super) fn storage(
        &self,
        generation: &str,
        cancel: &AtomicBool,
    ) -> AppResult<AgentSessionStorage> {
        let index = self.index.lock();
        let snapshot = index
            .snapshot
            .as_ref()
            .filter(|snapshot| snapshot.generation == generation)
            .ok_or_else(|| AppError::custom(CustomErrorCode::AgentSessionChanged))?
            .clone();
        let mut found = resources(&index.entries);
        found.extend(resources(&index.hidden_entries));
        drop(index);
        let mut result = storage::snapshot(generation, &snapshot.sources, &found, cancel)?;
        result.complete &= snapshot.complete;
        self.check_generation(generation)?;
        Ok(result)
    }
}
