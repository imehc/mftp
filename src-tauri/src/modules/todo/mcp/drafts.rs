use std::{
    collections::BTreeMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

use parking_lot::Mutex;

use super::super::{
    note_model::{
        TodoNoteDetails, TodoNoteDraft, TodoNoteImageImport, TodoNoteImageInfo, TodoNoteSaveInput,
    },
    note_service::TodoNoteService,
    TodoRepository,
};
use super::model::{DraftOutput, ImportInput, NoteLimits, SaveState, SaveStatusOutput};
use crate::error::{AppError, AppResult, CustomErrorCode};

const SUBJECT_LIMIT: usize = 2;
const IDLE_TTL: Duration = Duration::from_secs(15 * 60);
const MAX_AGE: Duration = Duration::from_secs(60 * 60);

struct Entry {
    subject: String,
    draft: TodoNoteDraft,
    created: Instant,
    touched: Instant,
}

struct Receipt {
    subject: String,
    item_id: String,
    revision: i64,
    created: Instant,
}

#[cfg(test)]
#[path = "draft_tests.rs"]
mod tests;

pub(crate) struct Drafts {
    entries: Mutex<BTreeMap<String, Entry>>,
    repository: TodoRepository,
    notes: Arc<TodoNoteService>,
    closed: AtomicBool,
    receipts: Mutex<BTreeMap<String, Receipt>>,
}

impl Drafts {
    pub(crate) fn reopen(&self) -> AppResult<()> {
        let entries = self.entries.lock();
        if !entries.is_empty() {
            return Err(AppError::custom(CustomErrorCode::TodoNoteBusy));
        }
        self.closed.store(false, Ordering::Release);
        Ok(())
    }
    pub(crate) fn new(repository: TodoRepository, notes: Arc<TodoNoteService>) -> Self {
        Self {
            entries: Mutex::new(BTreeMap::new()),
            repository,
            notes,
            closed: AtomicBool::new(false),
            receipts: Mutex::new(BTreeMap::new()),
        }
    }

    fn sweep(&self, entries: &mut BTreeMap<String, Entry>) -> AppResult<()> {
        if self.closed.load(Ordering::Acquire) {
            return Err(AppError::custom(CustomErrorCode::TodoNoteDraftClosed));
        }
        let expired: Vec<_> = entries
            .iter()
            .filter(|(_, entry)| {
                entry.touched.elapsed() >= IDLE_TTL || entry.created.elapsed() >= MAX_AGE
            })
            .map(|(id, _)| id.clone())
            .collect();
        for id in expired {
            self.notes.close_draft(&id)?;
            entries.remove(&id);
        }
        Ok(())
    }

    pub(crate) fn begin(&self, subject: &str, item_id: Option<&str>) -> AppResult<DraftOutput> {
        let mut entries = self
            .entries
            .try_lock()
            .ok_or_else(|| AppError::custom(CustomErrorCode::TodoNoteBusy))?;
        self.sweep(&mut entries)?;
        if subject.is_empty()
            || entries
                .values()
                .filter(|entry| entry.subject == subject)
                .count()
                >= SUBJECT_LIMIT
        {
            return Err(AppError::custom(CustomErrorCode::TodoNoteDraftLimit));
        }
        let draft = self.repository.begin_note_draft(item_id)?;
        let images = self.repository.mcp_draft_images(&draft.id);
        let images = match images {
            Ok(images) => images,
            Err(error) => {
                self.notes.close_draft(&draft.id)?;
                return Err(error);
            }
        };
        let now = Instant::now();
        entries.insert(
            draft.id.clone(),
            Entry {
                subject: subject.into(),
                draft: draft.clone(),
                created: now,
                touched: now,
            },
        );
        Ok(DraftOutput {
            draft,
            images,
            limits: NoteLimits::default(),
        })
    }

    fn with_owned<T>(
        &self,
        subject: &str,
        id: &str,
        operation: impl FnOnce(&TodoNoteDraft) -> AppResult<T>,
    ) -> AppResult<T> {
        let mut entries = self
            .entries
            .try_lock()
            .ok_or_else(|| AppError::custom(CustomErrorCode::TodoNoteBusy))?;
        self.sweep(&mut entries)?;
        let entry = entries
            .get_mut(id)
            .filter(|entry| entry.subject == subject && !subject.is_empty())
            .ok_or_else(|| AppError::custom(CustomErrorCode::TodoNoteDraftClosed))?;
        self.repository.ensure_note_draft(id)?;
        entry.touched = Instant::now();
        operation(&entry.draft)
    }

    pub(crate) fn get(&self, subject: &str, id: &str) -> AppResult<DraftOutput> {
        self.with_owned(subject, id, |draft| {
            Ok(DraftOutput {
                draft: self.repository.mcp_draft_snapshot(draft)?,
                images: self.repository.mcp_draft_images(id)?,
                limits: NoteLimits::default(),
            })
        })
    }

    pub(crate) fn import(
        &self,
        subject: &str,
        input: ImportInput,
        cancelled: impl Fn() -> bool,
    ) -> AppResult<TodoNoteImageImport> {
        self.with_owned(subject, &input.draft_id, |_| {
            self.notes.import_image_cancellable(
                &input.draft_id,
                &input.data_base64,
                Some(&input.mime_type),
                cancelled,
            )
        })
    }

    pub(crate) fn copy(
        &self,
        subject: &str,
        id: &str,
        source: &str,
        image: &str,
    ) -> AppResult<TodoNoteImageInfo> {
        self.with_owned(subject, id, |_| {
            self.repository.copy_note_image(id, source, image)
        })
    }

    pub(crate) fn read(
        &self,
        subject: &str,
        id: &str,
        image: &str,
        thumbnail: bool,
    ) -> AppResult<super::super::note_model::TodoNoteImageData> {
        self.with_owned(subject, id, |_| {
            self.repository
                .note_image_data(image, None, Some(id), thumbnail)
        })
    }

    pub(crate) fn discard(&self, subject: &str, id: &str, image: &str) -> AppResult<()> {
        self.with_owned(subject, id, |_| {
            self.repository.mcp_discard_image(id, image)
        })
    }

    pub(crate) fn save(
        &self,
        subject: &str,
        input: TodoNoteSaveInput,
    ) -> AppResult<TodoNoteDetails> {
        let mut entries = self
            .entries
            .try_lock()
            .ok_or_else(|| AppError::custom(CustomErrorCode::TodoNoteBusy))?;
        self.sweep(&mut entries)?;
        let id = input.draft_id.clone();
        let entry = entries
            .get(&id)
            .filter(|entry| entry.subject == subject && !subject.is_empty())
            .ok_or_else(|| AppError::custom(CustomErrorCode::TodoNoteDraftClosed))?;
        self.repository.ensure_note_draft(&entry.draft.id)?;
        let result = self.notes.save(input)?;
        let mut receipts = self.receipts.lock();
        receipts.retain(|_, receipt| receipt.created.elapsed() < IDLE_TTL);
        if receipts.len() >= 128 {
            if let Some(oldest) = receipts
                .iter()
                .min_by_key(|(_, receipt)| receipt.created)
                .map(|(id, _)| id.clone())
            {
                receipts.remove(&oldest);
            }
        }
        receipts.insert(
            id.clone(),
            Receipt {
                subject: subject.into(),
                item_id: result.item.id.clone(),
                revision: result.revision,
                created: Instant::now(),
            },
        );
        entries.remove(&id);
        Ok(result)
    }

    pub(crate) fn save_status(&self, subject: &str, id: &str) -> AppResult<SaveStatusOutput> {
        if subject.is_empty() {
            return Err(AppError::custom(CustomErrorCode::TodoNoteDraftClosed));
        }
        let mut entries = self
            .entries
            .try_lock()
            .ok_or_else(|| AppError::custom(CustomErrorCode::TodoNoteBusy))?;
        self.sweep(&mut entries)?;
        if let Some(entry) = entries.get(id) {
            if entry.subject != subject {
                return Err(AppError::custom(CustomErrorCode::TodoNoteDraftClosed));
            }
            return Ok(SaveStatusOutput {
                state: SaveState::Draft,
                item_id: entry.draft.item.as_ref().map(|item| item.id.clone()),
                revision: entry.draft.base_revision,
            });
        }
        let mut receipts = self.receipts.lock();
        receipts.retain(|_, receipt| receipt.created.elapsed() < IDLE_TTL);
        if let Some(receipt) = receipts
            .get(id)
            .filter(|receipt| receipt.subject == subject)
        {
            return Ok(SaveStatusOutput {
                state: SaveState::Saved,
                item_id: Some(receipt.item_id.clone()),
                revision: Some(receipt.revision),
            });
        }
        Ok(SaveStatusOutput {
            state: SaveState::Unknown,
            item_id: None,
            revision: None,
        })
    }

    pub(crate) fn close(&self, subject: &str, id: &str) -> AppResult<()> {
        let mut entries = self
            .entries
            .try_lock()
            .ok_or_else(|| AppError::custom(CustomErrorCode::TodoNoteBusy))?;
        let entry = entries
            .get(id)
            .filter(|entry| entry.subject == subject && !subject.is_empty())
            .ok_or_else(|| AppError::custom(CustomErrorCode::TodoNoteDraftClosed))?;
        self.notes.close_draft(&entry.draft.id)?;
        entries.remove(id);
        Ok(())
    }

    pub(crate) fn close_subject(&self, subject: &str) -> AppResult<()> {
        let mut entries = self.entries.lock();
        let ids: Vec<_> = entries
            .iter()
            .filter(|(_, entry)| entry.subject == subject)
            .map(|(id, _)| id.clone())
            .collect();
        for id in ids {
            self.notes.close_draft(&id)?;
            entries.remove(&id);
        }
        self.receipts
            .lock()
            .retain(|_, receipt| receipt.subject != subject);
        Ok(())
    }

    pub(crate) fn close_all(&self) -> AppResult<()> {
        self.closed.store(true, Ordering::Release);
        let mut entries = self.entries.lock();
        let ids: Vec<_> = entries.keys().cloned().collect();
        for id in ids {
            self.notes.close_draft(&id)?;
            entries.remove(&id);
        }
        self.receipts.lock().clear();
        Ok(())
    }

    pub(crate) fn busy(&self) -> AppResult<bool> {
        let mut entries = self
            .entries
            .try_lock()
            .ok_or_else(|| AppError::custom(CustomErrorCode::TodoNoteBusy))?;
        self.sweep(&mut entries)?;
        Ok(!entries.is_empty())
    }
}
