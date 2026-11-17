//! Todo workflow owner: one list projection, retained inputs and explicit write admission.

mod choices;
mod details;
mod dialogs;
pub(crate) use choices::view_key;
mod collection;
mod editing;
mod fields;
mod filters;
mod forms;
mod images;
mod metadata_tags;
mod presentation;
mod presentation_mode;
mod render;
mod rows;
mod thumbnails;

#[cfg(test)]
mod tests;

use super::{
    TodoClient,
    session::{Draft, Session},
};
use crate::{
    components::rich_text::{RichTextEditorState, RichTextEvent},
    i18n::{Locale, text},
    preferences::Preferences,
};
use gpui_kit::{
    AppContext, Context, Entity, EntityInputHandler, EventEmitter, FocusHandle, Subscription, Task,
    Window,
    component::{
        input::{InputEvent, InputState},
        list::ListState,
    },
};
use mftp_foundation::{AppError, AppResult};
use mftp_todo::{TodoRecord, TodoView};
pub(crate) use render::bind_keys;
use rows::TodoRows;
use std::time::Duration;

#[derive(Clone)]
pub(crate) enum Destination {
    New,
    Search,
    Edit(TodoRecord),
    Read(TodoRecord),
    CloseEditor,
    View(TodoView),
    Settings,
}

pub(crate) struct OpenSettings;

pub(crate) struct TodoPage {
    client: TodoClient,
    session: Session,
    rows: Entity<ListState<TodoRows>>,
    search: Entity<InputState>,
    title: Entity<InputState>,
    notes: Entity<RichTextEditorState>,
    fields: Entity<fields::MetadataFields>,
    view: TodoView,
    counts: [usize; 4],
    categories: Vec<String>,
    filters: Entity<filters::TodoFilters>,
    initialized: bool,
    loading: bool,
    read_error: Option<AppError>,
    write_error: Option<AppError>,
    persistence_error: Option<AppError>,
    busy: bool,
    writing_draft: bool,
    new_notes_open: bool,
    editing: bool,
    modal_open: bool,
    presentation_wide: bool,
    leave_destination: Option<Destination>,
    system_locale: Locale,
    syncing_inputs: bool,
    read_generation: u64,
    state_generation: u64,
    persist_timer: Option<Task<()>>,
    search_timer: Option<Task<()>>,
    after_save: Option<Destination>,
    image_action: Option<images::ImageAction>,
    focus_after_read: bool,
    new_focus: FocusHandle,
    details_focus: FocusHandle,
    detail_action: Option<details::DetailAction>,
    escape_was_composing: bool,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<OpenSettings> for TodoPage {}

impl TodoPage {
    pub fn new(client: TodoClient, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let owner = cx.weak_entity();
        let rows = cx
            .new(|list_cx| ListState::new(TodoRows::new(owner), window, list_cx).searchable(false));
        let resource_release = cx.on_release(|this, cx| {
            this.rows
                .update(cx, |list, cx| list.delegate_mut().clear_thumbnails(cx));
        });
        let search = cx.new(|cx| InputState::new(window, cx));
        let title = cx.new(|cx| InputState::new(window, cx));
        let notes = cx.new(|cx| RichTextEditorState::new(window, cx));
        let filters = cx.new(|cx| filters::TodoFilters::new(window, cx));
        let filter_subscription = cx.subscribe_in(
            &filters,
            window,
            |this, _, _: &filters::FiltersChanged, window, cx| this.reload(window, cx),
        );
        let fields = cx.new(|cx| fields::MetadataFields::new(window, cx));
        let fields_subscription = cx.subscribe_in(
            &fields,
            window,
            |this, _, _: &fields::FieldsChanged, window, cx| this.capture_draft(window, cx),
        );
        let query_subscription = cx.subscribe_in(
            &search,
            window,
            |this, _, event: &InputEvent, window, cx| {
                if matches!(event, InputEvent::Change) {
                    // Invalidate old reads immediately, then coalesce typing before queue admission.
                    this.read_generation += 1;
                    this.loading = true;
                    this.search_timer = Some(cx.spawn_in(window, async move |this, cx| {
                        cx.background_executor()
                            .timer(Duration::from_millis(150))
                            .await;
                        let _ = this.update_in(cx, |this, window, cx| this.reload(window, cx));
                    }));
                    cx.notify();
                }
            },
        );
        let title_subscription = cx.subscribe_in(
            &title,
            window,
            |this, input, event: &InputEvent, window, cx| match event {
                InputEvent::Change => this.capture_draft(window, cx),
                InputEvent::PressEnter { .. } => {
                    let composing = input.update(cx, |state, cx| {
                        state.marked_text_range(window, cx).is_some()
                    });
                    if !composing {
                        this.save(window, cx);
                    }
                }
                _ => {}
            },
        );
        let note_subscription = cx.subscribe_in(
            &notes,
            window,
            |this, _, event: &RichTextEvent, window, cx| match event {
                RichTextEvent::Changed => this.capture_draft(window, cx),
                RichTextEvent::OpenLink(url) => cx.open_url(url),
                RichTextEvent::ImportImage(request) => this.import_image(request, window, cx),
                RichTextEvent::ResourcesSettled => this.images_settled(window, cx),
                RichTextEvent::ReloadImages => {
                    this.capture_draft(window, cx);
                    this.load_image_previews(window, cx);
                }
                RichTextEvent::PasteImages(request) => this.paste_images(request, window, cx),
                RichTextEvent::CopyImage { id, epoch } => {
                    this.copy_note_image(id.clone(), *epoch, window, cx)
                }
            },
        );
        Self {
            client,
            session: Session::default(),
            rows,
            search,
            title,
            notes,
            fields,
            view: TodoView::Active,
            counts: [0; 4],
            categories: Vec::new(),
            filters,
            initialized: false,
            loading: true,
            read_error: None,
            write_error: None,
            persistence_error: None,
            busy: false,
            writing_draft: false,
            new_notes_open: false,
            editing: false,
            modal_open: false,
            presentation_wide: false,
            leave_destination: None,
            system_locale: sys_locale::get_locale()
                .as_deref()
                .map(Locale::from_system)
                .unwrap_or(Locale::English),
            syncing_inputs: false,
            read_generation: 0,
            state_generation: 0,
            persist_timer: None,
            search_timer: None,
            after_save: None,
            image_action: None,
            focus_after_read: false,
            new_focus: cx.focus_handle(),
            details_focus: cx.focus_handle(),
            detail_action: None,
            escape_was_composing: false,
            _subscriptions: vec![
                query_subscription,
                title_subscription,
                note_subscription,
                fields_subscription,
                filter_subscription,
                resource_release,
            ],
        }
    }

    pub fn restore(&mut self, session: Session, window: &mut Window, cx: &mut Context<Self>) {
        self.new_notes_open = session.draft.as_ref().is_some_and(|draft| {
            !draft.notes.is_empty()
                || draft
                    .document
                    .as_ref()
                    .is_some_and(|document| !document.source().is_empty())
        });
        self.session = session;
        self.initialized = true;
        self.update_input_labels(window, cx);
        self.sync_inputs(window, cx);
        self.editing = self
            .session
            .draft
            .as_ref()
            .is_some_and(|draft| draft.original.is_none() || draft.is_dirty());
        self.update_input_labels(window, cx);
        if self
            .session
            .draft
            .as_ref()
            .is_some_and(|draft| draft.original.is_none())
        {
            self.present_task(window, cx);
        }
        self.reload(window, cx);
    }

    pub fn startup_error(&mut self, error: AppError, cx: &mut Context<Self>) {
        self.loading = false;
        self.read_error = Some(error);
        cx.notify();
    }

    pub fn set_preferences(
        &mut self,
        preferences: Preferences,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.session.preferences = preferences;
        self.update_input_labels(window, cx);
        if self.initialized {
            self.publish(window, cx);
        }
        cx.notify();
    }

    fn update_input_labels(&self, window: &mut Window, cx: &mut Context<Self>) {
        let locale = self.locale();
        self.filters.update(cx, |filters, cx| {
            filters.refresh(locale, self.categories.clone(), window, cx)
        });
        self.search.update(cx, |input, cx| {
            input.set_placeholder(text("todo.search", locale).into_owned(), window, cx)
        });
        self.title.update(cx, |input, cx| {
            input.set_placeholder(text("todo.title", locale).into_owned(), window, cx)
        });
        self.fields.update(cx, |fields, cx| {
            fields.set_presentation(locale, self.busy, self.categories.clone(), window, cx)
        });
        self.notes.update(cx, |notes, cx| {
            notes.set_presentation(
                locale,
                text("todo.notes", locale).into_owned(),
                self.busy || !self.editing,
                cx,
            )
        });
    }

    fn set_busy(&mut self, busy: bool, cx: &mut Context<Self>) {
        self.busy = busy;
        self.fields
            .update(cx, |fields, cx| fields.set_disabled(busy, cx));
        let locale = self.locale();
        self.notes.update(cx, |notes, cx| {
            notes.set_presentation(
                locale,
                text("todo.notes", locale).into_owned(),
                busy || !self.editing,
                cx,
            )
        });
    }

    pub fn locale(&self) -> Locale {
        self.session
            .preferences
            .language()
            .resolve(self.system_locale)
    }

    #[cfg(test)]
    pub(crate) fn focus_notes_for_test(&self, window: &mut Window, cx: &mut gpui_kit::App) {
        self.notes.update(cx, |notes, cx| notes.focus(window, cx));
    }

    pub fn is_busy(&self) -> bool {
        self.busy
    }
    #[cfg(test)]
    pub fn is_loading(&self) -> bool {
        self.loading
    }
    pub fn view(&self) -> TodoView {
        self.view
    }
    pub fn count(&self, view: TodoView) -> usize {
        self.counts[view.index()]
    }

    /// Keep the window available when the latest draft cannot be persisted.
    pub fn request_close(&mut self, window: &mut Window, cx: &mut Context<Self>) -> bool {
        if self.notes.read(cx).has_pending_images() {
            self.image_action = Some(images::ImageAction::Close);
            return false;
        }
        if self.busy {
            return false;
        }
        if !self.initialized {
            return true;
        }
        self.capture_draft(window, cx);
        self.set_busy(true, cx);
        let task = self.client.persist_session();
        cx.spawn_in(window, async move |this, cx| {
            let result = match task {
                Ok(task) => task.await,
                Err(error) => Err(error),
            };
            let _ = this.update_in(cx, |this, window, cx| {
                this.set_busy(false, cx);
                match result {
                    Ok(()) => window.remove_window(),
                    Err(error) => {
                        this.persistence_error = Some(error);
                        cx.notify();
                    }
                }
            });
        })
        .detach();
        cx.notify();
        false
    }

    pub fn request(
        &mut self,
        destination: Destination,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if !self.initialized || self.busy {
            return;
        }
        if !matches!(destination, Destination::Settings) && self.notes.read(cx).has_pending_images()
        {
            self.image_action = Some(images::ImageAction::Navigate(Box::new(destination)));
            return;
        }
        // A key or click can arrive before an input Change subscription is delivered.
        self.capture_draft(window, cx);
        // Settings changes retain the same draft; they do not leave the editing workflow.
        if matches!(destination, Destination::Settings) {
            self.navigate(destination, window, cx);
            return;
        }
        if self.session.draft.as_ref().is_some_and(Draft::is_dirty) {
            self.confirm_leave(destination, window, cx);
        } else {
            self.navigate(destination, window, cx);
        }
    }

    fn navigate(&mut self, destination: Destination, window: &mut Window, cx: &mut Context<Self>) {
        match destination {
            Destination::New => {
                if self.view != TodoView::Active {
                    self.view = TodoView::Active;
                    self.rows.update(cx, |list, cx| {
                        list.delegate_mut().records.clear();
                        list.set_selected_index(None, window, cx);
                        cx.notify();
                    });
                    self.reload(window, cx);
                }
                self.session.draft = Some(Draft::new());
                self.editing = true;
                self.new_notes_open = true;
                self.sync_inputs(window, cx);
                self.update_input_labels(window, cx);
                self.present_task(window, cx);
                self.title.update(cx, |input, cx| input.focus(window, cx));
            }
            Destination::Edit(record) => {
                self.load_editor(record.item().id.clone(), true, window, cx);
                return;
            }
            Destination::Read(record) => {
                self.load_editor(record.item().id.clone(), false, window, cx);
                return;
            }
            Destination::CloseEditor => {
                self.session.draft = None;
                self.close_task_dialog(window, cx);
                self.editing = false;
                self.focus_collection(window, cx);
            }
            Destination::Search => {
                self.session.draft = None;
                self.close_task_dialog(window, cx);
                self.search.update(cx, |input, cx| input.focus(window, cx));
            }
            Destination::View(view) => {
                self.session.draft = None;
                self.close_task_dialog(window, cx);
                let changing_view = self.view != view;
                self.view = view;
                self.rows.update(cx, |list, cx| {
                    if changing_view {
                        list.delegate_mut().records.clear();
                    }
                    list.set_selected_index(None, window, cx);
                    cx.notify();
                });
                self.reload(window, cx);
            }
            Destination::Settings => {
                cx.emit(OpenSettings);
            }
        }
        self.write_error = None;
        self.publish(window, cx);
        cx.notify();
    }

    fn publish(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if let Err(error) = self.client.publish_session(self.session.clone()) {
            self.persistence_error = Some(error);
            cx.notify();
            return;
        }
        self.state_generation += 1;
        self.persist_timer = Some(cx.spawn_in(window, async move |this, cx| {
            cx.background_executor()
                .timer(Duration::from_millis(250))
                .await;
            let _ = this.update_in(cx, |this, window, cx| this.persist(window, cx));
        }));
    }

    fn persist(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let generation = self.state_generation;
        let task = self.client.persist_session();
        cx.spawn_in(window, async move |this, cx| {
            let result = match task {
                Ok(task) => task.await,
                Err(error) => Err(error),
            };
            let _ = this.update_in(cx, |this, _, cx| {
                if generation != this.state_generation {
                    return;
                }
                this.persistence_error = result.err();
                cx.notify();
            });
        })
        .detach();
    }
}
