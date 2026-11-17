//! One retained editor snapshot participates in native draft admission and persistence.

use super::TodoPage;
use gpui_kit::{Context, Window};

impl TodoPage {
    pub(super) fn load_editor(
        &mut self,
        id: String,
        editing: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.set_busy(true, cx);
        let task = self.client.load_document(id);
        cx.spawn_in(window, async move |this, cx| {
            let result = match task {
                Ok(task) => task.await,
                Err(error) => Err(error),
            };
            let _ = this.update_in(cx, |this, window, cx| {
                this.editing = editing;
                this.set_busy(false, cx);
                match result {
                    Ok((record, document)) => {
                        let mut draft = super::super::session::Draft::edit(&record);
                        draft.document = Some(document.clone());
                        draft.original_document = Some(document);
                        this.session.draft = Some(draft);
                        this.write_error = None;
                        this.sync_inputs(window, cx);
                        this.update_input_labels(window, cx);
                        if editing {
                            this.title.update(cx, |input, cx| input.focus(window, cx));
                        }
                        this.present_task(window, cx);
                        if !editing {
                            this.details_focus.focus(window, cx);
                        }
                        this.publish(window, cx);
                    }
                    Err(error) => {
                        this.session.draft = None;
                        this.write_error = Some(error);
                    }
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }

    pub(super) fn sync_inputs(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.syncing_inputs = true;
        let metadata = self
            .session
            .draft
            .as_ref()
            .and_then(|draft| draft.metadata.clone())
            .unwrap_or_default();
        self.fields
            .update(cx, |fields, cx| fields.set_value(metadata, window, cx));
        let title = self
            .session
            .draft
            .as_ref()
            .map(|draft| draft.title.clone())
            .unwrap_or_default();
        let document = self
            .session
            .draft
            .as_ref()
            .and_then(|draft| draft.document.clone())
            .unwrap_or_else(|| {
                crate::components::rich_text::RichTextDocument::from_plain_text(
                    self.session
                        .draft
                        .as_ref()
                        .map_or("", |draft| draft.notes.as_str()),
                )
            });
        self.title
            .update(cx, |input, cx| input.set_value(title, window, cx));
        if let Err(error) = self
            .notes
            .update(cx, |input, cx| input.set_document(document, cx))
        {
            self.write_error = Some(error);
        } else if let Some(draft) = self.session.draft.as_mut() {
            draft.document = Some(self.notes.read(cx).snapshot(cx));
            if draft.original_document.is_none() {
                draft.original_document = draft.original.as_ref().map(|item| {
                    crate::components::rich_text::RichTextDocument::from_plain_text(
                        item.notes.as_deref().unwrap_or_default(),
                    )
                });
            }
        }
        self.syncing_inputs = false;
        self.load_image_previews(window, cx);
    }

    pub(super) fn capture_draft(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.syncing_inputs || self.busy || !self.editing {
            return;
        }
        if let Some(draft) = &mut self.session.draft {
            let metadata = Some(self.fields.read(cx).snapshot(cx));
            let title = self.title.read(cx).value().to_string();
            let notes = self.notes.read(cx).value(cx);
            let document = Some(self.notes.read(cx).snapshot(cx));
            if draft.title == title
                && draft.notes == notes
                && draft.document == document
                && draft.metadata == metadata
            {
                return;
            }
            draft.metadata = metadata;
            draft.title = title;
            draft.notes = notes;
            draft.document = document;
            // Changing notes must not hide an unresolved title validation error.
            if !draft.title.trim().is_empty()
                || self
                    .write_error
                    .as_ref()
                    .is_none_or(|error| error.code != "todo:title_required")
            {
                self.write_error = None;
            }
            self.publish(window, cx);
            cx.notify();
        }
    }

    pub(super) fn save(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.busy || !self.initialized || !self.editing {
            return;
        }
        if self.notes.read(cx).has_pending_images() {
            self.image_action = Some(super::images::ImageAction::Save);
            return;
        }
        if self.notes.read(cx).has_failed_images(cx) {
            self.write_error = Some(crate::resources::images::error("missing"));
            cx.notify();
            return;
        }
        // Read the input now: a deferred Enter must not commit a later edit snapshot.
        self.capture_draft(window, cx);
        let Some(draft) = self.session.draft.clone() else {
            return;
        };
        if let Err(error) = draft
            .validated_input()
            .and_then(mftp_todo::repository::normalize_input)
        {
            self.after_save = None;
            if error.code == "todo:title_required" && self.leave_destination.is_none() {
                self.title.update(cx, |input, cx| input.focus(window, cx));
            }
            self.write_error = Some(error);
            cx.notify();
            return;
        }
        if let Some(document) = &draft.document
            && let Err(error) = document.validate()
        {
            self.write_error = Some(error);
            cx.notify();
            return;
        }
        self.set_busy(true, cx);
        self.writing_draft = true;
        self.write_error = None;
        let task = self.client.commit_draft(draft);
        cx.spawn_in(window, async move |this, cx| {
            let result = match task {
                Ok(task) => task.await,
                Err(error) => Err(error),
            };
            let _ = this.update_in(cx, |this, window, cx| {
                this.set_busy(false, cx);
                this.writing_draft = false;
                match result {
                    Ok(_) => {
                        let destination = this.after_save.take();
                        this.close_task_dialog(window, cx);
                        this.editing = false;
                        this.session.draft = None;
                        this.publish(window, cx);
                        this.reload(window, cx);
                        if let Some(destination) = destination {
                            this.navigate(destination, window, cx);
                        } else {
                            this.focus_after_read = true;
                        }
                    }
                    Err(error) => {
                        this.write_error = Some(error);
                        this.after_save = None;
                    }
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }
}
