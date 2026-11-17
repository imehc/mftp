//! Bounded native database worker. Only the outer process owner joins this thread.

use super::database::TodoDatabase;
use super::session::{self, Draft, Session};
use crate::platform::AppPaths;
use futures_channel::oneshot;
use mftp_foundation::{AppError, AppResult, CustomErrorCode};
use mftp_todo::{
    TodoRecord, TodoRepository, TodoView,
    model::{TodoItem, TodoItemInput},
};
use std::{
    future::Future,
    pin::Pin,
    sync::{
        Arc, Mutex,
        mpsc::{self, SyncSender, TrySendError},
    },
    task::{Context, Poll},
    thread::{self, JoinHandle},
};

const QUEUE_CAPACITY: usize = 16;
type Job = Box<dyn FnOnce(&AppResult<Runtime>) + Send>;
type Admission = Arc<Mutex<Option<SyncSender<Job>>>>;
type SharedSession = Arc<Mutex<Option<(Session, bool)>>>;

struct Runtime {
    repository: TodoRepository,
    database: TodoDatabase,
    session: SharedSession,
}

impl Runtime {
    fn flush(&self) -> AppResult<()> {
        // Snapshot outside I/O; input can keep publishing while SQLite is busy.
        let state = self.session.lock().map_err(|_| stopped())?.clone();
        let Some((state, true)) = state else {
            return Ok(());
        };
        session::save(&self.database, &state)?;
        let bytes = serde_json::to_string(&state)?;
        let mut current = self.session.lock().map_err(|_| stopped())?;
        if let Some((latest, dirty)) = current.as_mut()
            && serde_json::to_string(latest)? == bytes
        {
            *dirty = false;
        }
        Ok(())
    }
}

fn stopped() -> AppError {
    AppError::custom(CustomErrorCode::AppShuttingDown)
}

/// Dropping a reply abandons its projection, never cancels an accepted write.
pub struct TodoTask<T> {
    receiver: oneshot::Receiver<AppResult<T>>,
}

impl<T> Future for TodoTask<T> {
    type Output = AppResult<T>;
    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        match Pin::new(&mut self.receiver).poll(cx) {
            Poll::Pending => Poll::Pending,
            Poll::Ready(Ok(result)) => Poll::Ready(result),
            Poll::Ready(Err(_)) => Poll::Ready(Err(stopped())),
        }
    }
}

/// UI-safe handle: admission is nonblocking and all database work runs on the worker.
#[derive(Clone)]
pub struct TodoClient {
    admission: Admission,
    session: SharedSession,
}

impl gpui_kit::Global for TodoClient {}

impl TodoClient {
    fn submit<T: Send + 'static>(
        &self,
        operation: impl FnOnce(&Runtime) -> AppResult<T> + Send + 'static,
    ) -> AppResult<TodoTask<T>> {
        let (sender, receiver) = oneshot::channel();
        let job: Job = Box::new(move |repository| {
            let result = match repository {
                Ok(repository) => operation(repository),
                Err(error) => Err(error.clone()),
            };
            // A closed reply does not roll back or replay the completed operation.
            let _ = sender.send(result);
        });
        let admission = self.admission.lock().map_err(|_| stopped())?;
        let sender = admission.as_ref().ok_or_else(stopped)?;
        sender.try_send(job).map_err(|error| match error {
            TrySendError::Full(_) => {
                AppError::external("todo:worker_busy", "Native todo work queue is full")
            }
            TrySendError::Disconnected(_) => stopped(),
        })?;
        Ok(TodoTask { receiver })
    }

    pub fn list(&self, view: TodoView, query: String) -> AppResult<TodoTask<Vec<TodoRecord>>> {
        self.submit(move |runtime| runtime.repository.list_view(view, &query))
    }
    pub(crate) fn projection(
        &self,
        view: TodoView,
        query: String,
        category: Option<String>,
        priority: Option<mftp_todo::model::TodoPriority>,
    ) -> AppResult<TodoTask<super::note_summary::Projection>> {
        self.submit(move |runtime| {
            let todos = runtime.repository.projection(
                view,
                &query,
                category.as_deref(),
                priority,
                chrono::Utc::now().timestamp_millis(),
            )?;
            let mut notes = super::note_summary::load(&runtime.database)?;
            let ids: std::collections::HashSet<_> = todos
                .records
                .iter()
                .map(|record| record.item().id.as_str())
                .collect();
            notes.retain(|id, _| ids.contains(id.as_str()));
            Ok(super::note_summary::Projection { todos, notes })
        })
    }

    pub fn set_abandoned(
        &self,
        id: String,
        abandoned: bool,
        revision: i64,
    ) -> AppResult<TodoTask<TodoItem>> {
        self.submit(move |runtime| {
            runtime
                .repository
                .set_state(&id, abandoned, true, Some(revision))
        })
    }

    pub fn get(&self, id: String) -> AppResult<TodoTask<TodoRecord>> {
        self.submit(move |runtime| runtime.repository.get(&id))
    }

    pub(crate) fn load_document(
        &self,
        id: String,
    ) -> AppResult<TodoTask<(TodoRecord, crate::components::rich_text::RichTextDocument)>> {
        self.submit(move |runtime| {
            let record = runtime.repository.get(&id)?;
            let document = super::note_store::load_at_revision(
                &runtime.database,
                &id,
                record.revision(),
                record.item().notes.as_deref(),
            )?;
            Ok((record, document))
        })
    }

    pub(crate) fn load_images(
        &self,
        draft: Draft,
    ) -> AppResult<TodoTask<crate::resources::images::ImagePreviews>> {
        self.submit(move |runtime| super::note_images::load(&runtime.database, &draft))
    }

    pub(crate) fn row_thumbnail(
        &self,
        item: String,
        id: String,
    ) -> AppResult<TodoTask<Arc<gpui_kit::Image>>> {
        self.submit(move |runtime| super::note_transfer::thumbnail(&runtime.database, &item, &id))
    }

    pub(crate) fn copy_image(
        &self,
        draft: Draft,
        id: String,
    ) -> AppResult<TodoTask<Arc<gpui_kit::Image>>> {
        self.submit(move |runtime| super::note_transfer::read(&runtime.database, &draft, &id))
    }

    pub(crate) fn discard_images(
        &self,
        draft: String,
        ids: Vec<String>,
    ) -> AppResult<TodoTask<()>> {
        self.submit(move |runtime| super::note_transfer::discard(&runtime.database, &draft, &ids))
    }

    pub(crate) fn paste_images(
        &self,
        draft: Draft,
        source: String,
        cancelled: Arc<std::sync::atomic::AtomicBool>,
    ) -> AppResult<TodoTask<super::note_transfer::PastedImages>> {
        self.submit(move |runtime| {
            let current = runtime
                .session
                .lock()
                .map_err(|_| stopped())?
                .as_ref()
                .and_then(|(session, _)| session.draft.as_ref())
                .is_some_and(|current| current.id == draft.id);
            if !current {
                return Err(crate::resources::images::error("cancelled"));
            }
            super::note_transfer::paste(&runtime.database, &draft, &source, &cancelled)
        })
    }

    pub(crate) fn import_image(
        &self,
        draft: String,
        id: String,
        input: crate::resources::images::ImageInput,
        cancelled: Arc<std::sync::atomic::AtomicBool>,
    ) -> AppResult<TodoTask<Arc<gpui_kit::Image>>> {
        self.submit(move |runtime| {
            let is_current = || {
                runtime.session.lock().map_err(|_| stopped()).map(|slot| {
                    slot.as_ref()
                        .and_then(|(session, _)| session.draft.as_ref())
                        .is_some_and(|current| current.id == draft)
                })
            };
            if !is_current()? {
                return Err(crate::resources::images::error("cancelled"));
            }
            let preview =
                super::note_images::import(&runtime.database, &draft, &id, &input, &cancelled)?;
            // Accepted work may finish after removal; only its own new resource can become unused.
            if !is_current()? {
                return Err(crate::resources::images::error("cancelled"));
            }
            Ok(preview)
        })
    }
    pub fn create(&self, input: TodoItemInput) -> AppResult<TodoTask<TodoItem>> {
        self.submit(move |runtime| runtime.repository.create(input))
    }
    pub fn update(
        &self,
        id: String,
        input: TodoItemInput,
        revision: i64,
    ) -> AppResult<TodoTask<TodoItem>> {
        self.submit(move |runtime| {
            if super::note_store::has_document(&runtime.database, &id)?
                && mftp_todo::repository::normalize_input(input.clone())?.notes
                    != runtime.repository.get(&id)?.item().notes
            {
                return Err(AppError::custom(CustomErrorCode::TodoNoteConflict));
            }
            runtime
                .repository
                .update_at_revision(&id, input, Some(revision))
        })
    }
    pub fn set_completed(
        &self,
        id: String,
        completed: bool,
        revision: i64,
    ) -> AppResult<TodoTask<TodoItem>> {
        self.submit(move |runtime| {
            runtime
                .repository
                .set_state(&id, completed, false, Some(revision))
        })
    }
    pub fn delete(&self, id: String, revision: i64) -> AppResult<TodoTask<()>> {
        self.submit(move |runtime| runtime.repository.delete_at_revision(&id, Some(revision)))
    }

    pub(crate) fn load_session(&self) -> AppResult<TodoTask<Session>> {
        self.submit(|runtime| {
            runtime
                .session
                .lock()
                .map_err(|_| stopped())?
                .as_ref()
                .map(|(state, _)| state.clone())
                .ok_or_else(stopped)
        })
    }

    /// Publish the latest UI snapshot without performing file or SQLite I/O on the UI thread.
    pub(crate) fn publish_session(&self, state: Session) -> AppResult<()> {
        let admission = self.admission.lock().map_err(|_| stopped())?;
        if admission.is_none() {
            return Err(stopped());
        }
        let mut slot = self.session.lock().map_err(|_| stopped())?;
        if slot.is_none() {
            return Err(stopped());
        }
        *slot = Some((state, true));
        Ok(())
    }

    pub(crate) fn persist_session(&self) -> AppResult<TodoTask<()>> {
        self.submit(|runtime| runtime.flush())
    }

    pub(crate) fn commit_draft(&self, draft: Draft) -> AppResult<TodoTask<TodoItem>> {
        self.submit(move |runtime| {
            // Save identity before a write; a crash after creation can be reconciled by ID.
            runtime.flush()?;
            let item = super::note_store::commit(&runtime.database, &draft)?;
            // A bookkeeping lock failure must not turn a committed business write into a failure.
            let mut state = runtime
                .session
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            if let Some((state, dirty)) = state.as_mut()
                && state
                    .draft
                    .as_ref()
                    .is_some_and(|value| value.id == draft.id)
            {
                state.draft = None;
                *dirty = true;
            }
            Ok(item)
        })
    }
}

/// Retained outside the GPUI event loop; shutdown drains accepted jobs and joins the real worker.
pub struct TodoWorker {
    admission: Admission,
    session: SharedSession,
    thread: Option<JoinHandle<AppResult<()>>>,
}

impl TodoWorker {
    pub fn start(paths: AppPaths) -> AppResult<(Self, TodoTask<()>)> {
        let (sender, receiver) = mpsc::sync_channel::<Job>(QUEUE_CAPACITY);
        let admission = Arc::new(Mutex::new(Some(sender)));
        let session = Arc::new(Mutex::new(None));
        let worker_session = session.clone();
        let (ready_sender, ready_receiver) = oneshot::channel();
        let thread = thread::Builder::new()
            .name("mftp-native-todo".into())
            .spawn(move || {
                let repository = TodoDatabase::open(&paths).and_then(|database| {
                    let mut state = session::load(&database)?;
                    let repository = TodoRepository::new(Arc::new(database.clone()));
                    if let Some(draft) = &state.draft
                        && draft.original.is_none()
                    {
                        match repository.get(&draft.id) {
                            Ok(_) => state.draft = None,
                            Err(error) if error.code == "todo:item_not_found" => {}
                            Err(error) => return Err(error),
                        }
                    }
                    *worker_session.lock().map_err(|_| stopped())? = Some((state, true));
                    Ok(Runtime {
                        repository,
                        database,
                        session: worker_session,
                    })
                });
                let ready = repository.as_ref().map(|_| ()).map_err(Clone::clone);
                let _ = ready_sender.send(ready.clone());
                while let Ok(job) = receiver.recv() {
                    job(&repository);
                    if let Ok(runtime) = &repository
                        && let Err(error) = runtime.flush()
                    {
                        eprintln!("Failed to persist native state: {}", error.code);
                    }
                }
                // Failed initialization remains a failure, never an empty database.
                ready?;
                match repository {
                    Ok(runtime) => runtime.flush(),
                    Err(error) => Err(error),
                }
            })?;
        Ok((
            Self {
                admission,
                session,
                thread: Some(thread),
            },
            TodoTask {
                receiver: ready_receiver,
            },
        ))
    }

    pub fn client(&self) -> TodoClient {
        TodoClient {
            admission: self.admission.clone(),
            session: self.session.clone(),
        }
    }

    /// Call after the UI event loop exits, or on a blocking executor.
    pub fn shutdown(mut self) -> AppResult<()> {
        self.finish()
    }

    fn finish(&mut self) -> AppResult<()> {
        // Admission and closure share one lock, so no late send can race the stop boundary.
        self.admission
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take();
        if let Some(thread) = self.thread.take() {
            thread.join().map_err(|_| {
                AppError::external("task:panicked", "Native todo worker panicked")
            })??;
        }
        Ok(())
    }
}

impl Drop for TodoWorker {
    fn drop(&mut self) {
        if let Err(error) = self.finish() {
            eprintln!("Native todo worker shutdown failed: {}", error.code);
        }
    }
}

#[cfg(test)]
#[path = "worker_tests.rs"]
mod tests;
