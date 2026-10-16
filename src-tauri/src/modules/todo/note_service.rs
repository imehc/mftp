use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use base64::{engine::general_purpose::STANDARD, Engine};
use parking_lot::Mutex;

use super::note_image::{prepare_note_image, NoteImageError, PreparedNoteImage, MAX_INPUT_BYTES};
use super::note_model::{TodoNoteDetails, TodoNoteImageImport, TodoNoteSaveInput};
use super::TodoRepository;
use crate::error::{AppError, AppResult, CustomErrorCode};

static IMAGE_WORKER: Mutex<()> = Mutex::new(());

pub(super) fn prepare_image(bytes: &[u8]) -> AppResult<PreparedNoteImage> {
    let _worker = IMAGE_WORKER
        .try_lock()
        .ok_or_else(|| AppError::custom(CustomErrorCode::TodoNoteBusy))?;
    prepare_note_image(bytes, || false).map_err(image_error)
}

fn image_error(error: NoteImageError) -> AppError {
    AppError::custom(match error {
        NoteImageError::Cancelled => CustomErrorCode::TodoNoteCancelled,
        NoteImageError::InputTooLarge
        | NoteImageError::DecodeLimit
        | NoteImageError::OutputTooLarge => CustomErrorCode::TodoNoteImageLimit,
        NoteImageError::PixelLimit => CustomErrorCode::TodoNoteImagePixels,
        NoteImageError::EdgeLimit => CustomErrorCode::TodoNoteImageDimensions,
        NoteImageError::UnsupportedFormat | NoteImageError::AnimatedImage => {
            CustomErrorCode::TodoNoteImageUnsupported
        }
        NoteImageError::Codec(source) => {
            return AppError::custom(CustomErrorCode::TodoNoteImageInvalid).context(source);
        }
    })
}

#[cfg(test)]
#[path = "note_service_tests.rs"]
mod tests;

struct ActiveImage {
    draft_id: String,
    cancelled: Arc<AtomicBool>,
}

struct ActiveImageGuard<'a>(&'a Mutex<Option<ActiveImage>>);

impl Drop for ActiveImageGuard<'_> {
    fn drop(&mut self) {
        self.0.lock().take();
    }
}

pub(crate) struct TodoNoteService {
    repository: TodoRepository,
    active: Mutex<Option<ActiveImage>>,
}

impl TodoNoteService {
    pub(crate) fn new(repository: TodoRepository) -> Self {
        Self {
            repository,
            active: Mutex::new(None),
        }
    }

    pub(crate) fn import_image(
        &self,
        draft_id: &str,
        data_base64: &str,
    ) -> AppResult<TodoNoteImageImport> {
        if data_base64.len() > MAX_INPUT_BYTES.div_ceil(3) * 4 {
            return Err(AppError::custom(CustomErrorCode::TodoNoteImageLimit));
        }
        let _worker = IMAGE_WORKER
            .try_lock()
            .ok_or_else(|| AppError::custom(CustomErrorCode::TodoNoteBusy))?;
        self.repository.ensure_note_draft(draft_id)?;
        let cancelled = Arc::new(AtomicBool::new(false));
        *self.active.lock() = Some(ActiveImage {
            draft_id: draft_id.into(),
            cancelled: cancelled.clone(),
        });
        let _active = ActiveImageGuard(&self.active);
        let bytes = STANDARD
            .decode(data_base64)
            .map_err(|_| AppError::custom(CustomErrorCode::TodoNoteImageInvalid))?;
        let prepared = prepare_note_image(&bytes, || cancelled.load(Ordering::Acquire))
            .map_err(image_error)?;
        if cancelled.load(Ordering::Acquire) {
            return Err(AppError::custom(CustomErrorCode::TodoNoteCancelled));
        }
        self.repository.store_draft_image(draft_id, prepared)
    }

    pub(crate) fn close_draft(&self, draft_id: &str) -> AppResult<()> {
        if let Some(active) = self
            .active
            .lock()
            .as_ref()
            .filter(|active| active.draft_id == draft_id)
        {
            active.cancelled.store(true, Ordering::Release);
        }
        self.repository.close_note_draft(draft_id)?;
        let _worker = IMAGE_WORKER.lock();
        Ok(())
    }

    pub(crate) fn save(&self, input: TodoNoteSaveInput) -> AppResult<TodoNoteDetails> {
        let _worker = IMAGE_WORKER
            .try_lock()
            .ok_or_else(|| AppError::custom(CustomErrorCode::TodoNoteBusy))?;
        self.repository.save_note(input)
    }
}
