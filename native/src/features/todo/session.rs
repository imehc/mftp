//! Versioned native UI state. A restored draft never replays a business operation.

use super::database::TodoDatabase;
use crate::components::rich_text::RichTextDocument;
use crate::preferences::Preferences;
use mftp_foundation::{AppError, AppResult};
use mftp_todo::{
    Database, TodoRecord,
    model::{TodoItem, TodoItemInput},
};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};

const KEY: &str = "native_ui_v1";
const MAX_STATE_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct Draft {
    pub id: String,
    pub original: Option<TodoItem>,
    pub revision: Option<i64>,
    pub title: String,
    pub notes: String,
    #[serde(default)]
    pub metadata: Option<super::metadata::Metadata>,
    #[serde(default)]
    pub document: Option<RichTextDocument>,
    #[serde(default)]
    pub original_document: Option<RichTextDocument>,
}

impl Draft {
    pub fn new() -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            original: None,
            revision: None,
            title: String::new(),
            notes: String::new(),
            metadata: Some(super::metadata::Metadata::default()),
            document: None,
            original_document: None,
        }
    }

    pub fn edit(record: &TodoRecord) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            original: Some(record.item().clone()),
            revision: Some(record.revision()),
            title: record.item().title.clone(),
            notes: record.item().notes.clone().unwrap_or_default(),
            metadata: Some(super::metadata::Metadata::from_item(record.item())),
            document: None,
            original_document: None,
        }
    }

    pub fn is_dirty(&self) -> bool {
        match &self.original {
            Some(item) => {
                self.metadata
                    .as_ref()
                    .is_some_and(|metadata| *metadata != super::metadata::Metadata::from_item(item))
                    || self.title != item.title
                    || self.notes != item.notes.as_deref().unwrap_or_default()
                    || match (&self.document, &self.original_document) {
                        (Some(document), Some(original)) => !document.equivalent(original),
                        (None, None) => false,
                        _ => true,
                    }
            }
            None => {
                self.metadata
                    .as_ref()
                    .is_some_and(|metadata| *metadata != super::metadata::Metadata::default())
                    || !self.title.is_empty()
                    || !self.notes.is_empty()
                    || self
                        .document
                        .as_ref()
                        .is_some_and(|document| !document.source().is_empty())
            }
        }
    }

    pub fn input(&self) -> TodoItemInput {
        let original = self.original.as_ref();
        let metadata = self.metadata.clone().unwrap_or_else(|| {
            original
                .map(super::metadata::Metadata::from_item)
                .unwrap_or_default()
        });
        TodoItemInput {
            title: self.title.clone(),
            notes: Some(self.notes.clone()),
            completed: original.is_some_and(|item| item.completed),
            category: Some(metadata.category),
            due_date: metadata.date,
            due_at: metadata.instant,
            priority: metadata.priority,
        }
    }
    pub fn validated_input(&self) -> AppResult<TodoItemInput> {
        let mut input = self.input();
        if let Some(metadata) = &self.metadata {
            input.due_at = metadata.validate()?;
        }
        Ok(input)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct Session {
    version: u32,
    pub preferences: Preferences,
    pub draft: Option<Draft>,
}

impl Default for Session {
    fn default() -> Self {
        Self {
            version: 3,
            preferences: Preferences::default(),
            draft: None,
        }
    }
}

pub(super) fn load(database: &TodoDatabase) -> AppResult<Session> {
    let conn = database.conn()?;
    let bytes: Option<String> = conn
        .query_row("SELECT value FROM app_meta WHERE key=?1", [KEY], |row| {
            row.get(0)
        })
        .optional()?;
    let Some(bytes) = bytes else {
        return Ok(Session::default());
    };
    if bytes.len() > MAX_STATE_BYTES {
        return Err(invalid());
    }
    let mut state: Session = serde_json::from_str(&bytes).map_err(|_| invalid())?;
    if !matches!(state.version, 1..=3)
        || state.draft.as_ref().is_some_and(|draft| {
            uuid::Uuid::parse_str(&draft.id).is_err()
                || (draft.original.is_some() != draft.revision.is_some())
                || draft.revision.is_some_and(|revision| revision < 0)
                || draft
                    .original
                    .as_ref()
                    .is_some_and(|item| uuid::Uuid::parse_str(&item.id).is_err())
        })
    {
        return Err(invalid());
    }
    state.version = 3;
    if let Some(draft) = state.draft.as_mut() {
        if draft.metadata.is_none() {
            draft.metadata = Some(
                draft
                    .original
                    .as_ref()
                    .map(super::metadata::Metadata::from_item)
                    .unwrap_or_default(),
            );
        }
        if draft
            .document
            .as_ref()
            .is_some_and(|document| !document.is_supported_version())
            || draft
                .original_document
                .as_ref()
                .is_some_and(|document| !document.is_supported_version())
        {
            return Err(invalid());
        }
        if draft.document.is_none() {
            draft.document = Some(RichTextDocument::from_plain_text(&draft.notes));
        }
        if draft.original_document.is_none() {
            draft.original_document = draft.original.as_ref().map(|item| {
                RichTextDocument::from_plain_text(item.notes.as_deref().unwrap_or_default())
            });
        }
    }
    Ok(state)
}

pub(super) fn save(database: &TodoDatabase, state: &Session) -> AppResult<()> {
    let bytes = serde_json::to_string(state)?;
    if bytes.len() > MAX_STATE_BYTES {
        return Err(invalid());
    }
    let mut conn = database.conn()?;
    let tx = conn.transaction()?;
    tx.execute("INSERT INTO app_meta(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![KEY, bytes])?;
    super::note_images::prune_drafts(&tx, state.draft.as_ref().map(|draft| draft.id.as_str()))?;
    tx.commit()?;
    Ok(())
}

fn invalid() -> AppError {
    AppError::external(
        "native:state_invalid",
        "Unsupported or oversized native UI state",
    )
}

#[cfg(test)]
#[path = "session_tests.rs"]
mod tests;
