//! Existing application storage and rich-note extensions around the shared repository.

#[cfg(test)]
use super::model::TodoPriority;
use super::model::{TodoItem, TodoItemInput};
use crate::error::AppResult;
use crate::storage::Storage;
use std::sync::Arc;

pub(super) use mftp_todo::repository::{
    check_expected_revision, normalize_input, row_to_item, SELECT_COLUMNS,
};

struct TodoDatabase(Storage);

impl mftp_todo::Database for TodoDatabase {
    fn conn(&self) -> AppResult<rusqlite::Connection> {
        self.0.conn()
    }
}

#[derive(Clone)]
pub(crate) struct TodoRepository {
    pub(super) storage: Storage,
    shared: mftp_todo::TodoRepository,
}

impl TodoRepository {
    #[cfg(test)]
    pub(crate) fn new(storage: Storage) -> Self {
        let shared = mftp_todo::TodoRepository::new(Arc::new(TodoDatabase(storage.clone())));
        Self { storage, shared }
    }

    pub(crate) fn with_listener(
        storage: Storage,
        changed: Arc<dyn Fn(super::events::TodoChanged) + Send + Sync>,
    ) -> Self {
        let shared = mftp_todo::TodoRepository::with_listener(
            Arc::new(TodoDatabase(storage.clone())),
            changed,
        );
        Self { storage, shared }
    }

    pub(super) fn notify_changed(&self, id: &str) {
        self.shared.notify_changed(id);
    }

    pub(crate) fn list(&self) -> AppResult<Vec<TodoItem>> {
        self.shared.list()
    }
    pub(crate) fn create(&self, input: TodoItemInput) -> AppResult<TodoItem> {
        self.shared.create(input)
    }
    pub(crate) fn update(&self, id: &str, input: TodoItemInput) -> AppResult<TodoItem> {
        self.shared.update(id, input)
    }
    pub(crate) fn set_completed(&self, id: &str, completed: bool) -> AppResult<TodoItem> {
        self.shared.set_completed(id, completed)
    }
    pub(crate) fn set_abandoned(&self, id: &str, abandoned: bool) -> AppResult<TodoItem> {
        self.shared.set_abandoned(id, abandoned)
    }
    pub(super) fn set_state(
        &self,
        id: &str,
        value: bool,
        abandoned: bool,
        revision: Option<i64>,
    ) -> AppResult<TodoItem> {
        self.shared.set_state(id, value, abandoned, revision)
    }
    pub(crate) fn delete(&self, id: &str) -> AppResult<()> {
        self.shared.delete(id)
    }
    pub(super) fn delete_at_revision(&self, id: &str, revision: Option<i64>) -> AppResult<()> {
        self.shared.delete_at_revision(id, revision)
    }
}

#[cfg(test)]
#[path = "repository_tests.rs"]
mod tests;
#[cfg(test)]
#[path = "time_tests.rs"]
mod time_tests;
