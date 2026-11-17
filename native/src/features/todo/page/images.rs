//! The feature owns import persistence; the reusable editor owns optimistic atoms.
use super::{Destination, TodoPage};
use crate::components::rich_text::{ImageRequest, PasteImagesRequest};
use gpui_kit::{Context, Window};

pub(super) enum ImageAction {
    Save,
    Close,
    Navigate(Box<Destination>),
}

impl TodoPage {
    pub(super) fn paste_images(
        &self,
        request: &PasteImagesRequest,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(draft) = self.session.draft.clone() else {
            self.notes.update(cx, |notes, cx| {
                notes.resolve_image_paste(
                    request,
                    Err(crate::resources::images::error("cancelled")),
                    window,
                    cx,
                );
            });
            return;
        };
        let draft_id = draft.id.clone();
        let task =
            self.client
                .paste_images(draft, request.source.clone(), request.cancelled.clone());
        let request = request.clone();
        cx.spawn_in(window, async move |this, cx| {
            let result = match task {
                Ok(task) => task.await.map(|result| (result.source, result.previews)),
                Err(error) => Err(error),
            };
            let imports: Vec<String> = result
                .as_ref()
                .map(|(_, previews)| previews.iter().map(|(id, _)| id.clone()).collect())
                .unwrap_or_default();
            let _ = this.update_in(cx, |this, window, cx| {
                let accepted = this.notes.update(cx, |notes, cx| {
                    notes.resolve_image_paste(&request, result, window, cx)
                });
                if !accepted && !imports.is_empty() {
                    let cleanup = this.client.discard_images(draft_id, imports);
                    cx.spawn_in(window, async move |this, cx| {
                        let result = match cleanup {
                            Ok(task) => task.await,
                            Err(error) => Err(error),
                        };
                        if let Err(error) = result {
                            let _ = this.update_in(cx, |this, _, cx| {
                                this.persistence_error = Some(error);
                                cx.notify();
                            });
                        }
                    })
                    .detach();
                }
            });
        })
        .detach();
    }

    pub(super) fn copy_note_image(
        &self,
        id: String,
        epoch: u64,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(draft) = self.session.draft.clone() else {
            return;
        };
        let identity = draft.id.clone();
        let task = self.client.copy_image(draft, id);
        cx.spawn_in(window, async move |this, cx| {
            let result = match task {
                Ok(task) => task.await,
                Err(error) => Err(error),
            };
            let _ = this.update_in(cx, |this, window, cx| {
                if !this
                    .session
                    .draft
                    .as_ref()
                    .is_some_and(|draft| draft.id == identity)
                {
                    return;
                }
                this.notes.update(cx, |notes, cx| {
                    notes.resolve_image_copy(epoch, result, window, cx)
                });
            });
        })
        .detach();
    }

    pub(super) fn import_image(
        &mut self,
        request: &ImageRequest,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(draft) = self.session.draft.as_ref() else {
            self.notes.update(cx, |notes, cx| {
                notes.resolve_image(
                    request.epoch(),
                    request.id(),
                    Err(crate::resources::images::error("cancelled")),
                    window,
                    cx,
                )
            });
            return;
        };
        let epoch = request.epoch();
        let id = request.id().to_owned();
        let task = self.client.import_image(
            draft.id.clone(),
            id.clone(),
            request.input(),
            request.cancellation(),
        );
        cx.spawn_in(window, async move |this, cx| {
            let result = match task {
                Ok(task) => task.await,
                Err(error) => Err(error),
            };
            let _ = this.update_in(cx, |this, window, cx| {
                this.notes.update(cx, |notes, cx| {
                    notes.resolve_image(epoch, &id, result, window, cx)
                });
            });
        })
        .detach();
    }

    pub(super) fn load_image_previews(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !self.notes.read(cx).has_pending_images() {
            return;
        }
        let Some(draft) = self.session.draft.clone() else {
            return;
        };
        let epoch = self.notes.read(cx).image_epoch();
        let task = self.client.load_images(draft);
        cx.spawn_in(window, async move |this, cx| {
            let result = match task {
                Ok(task) => task.await,
                Err(error) => Err(error),
            };
            let _ = this.update_in(cx, |this, _, cx| {
                this.notes
                    .update(cx, |notes, cx| notes.set_image_previews(epoch, result, cx));
            });
        })
        .detach();
    }

    pub(super) fn images_settled(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.notes.read(cx).has_pending_images() {
            return;
        }
        match self.image_action.take() {
            Some(ImageAction::Save) => self.save(window, cx),
            Some(ImageAction::Close) => {
                self.request_close(window, cx);
            }
            Some(ImageAction::Navigate(destination)) => self.request(*destination, window, cx),
            None => {}
        }
        cx.notify();
    }
}
