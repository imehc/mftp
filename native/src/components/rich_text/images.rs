//! Optimistic atoms keep their identity while the host processes the resource.
use super::{RichTextEditorState, RichTextEvent, document};
use crate::{
    i18n::text,
    resources::images::{self, ImageInput},
};
use gpui_kit::{
    Anchor, App, Context, Image, ImageSource, IntoElement, Window,
    component::{
        ActiveTheme, Disableable, Sizable, WindowExt,
        button::{Button, ButtonVariants},
        notification::{Notification, NotificationDelivery},
        spinner::Spinner,
    },
    div,
    prelude::*,
};
use markdown_editor::{CapturedRange, CapturedRangeError};
use mftp_foundation::{AppError, AppResult};
use std::{
    collections::BTreeMap,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

pub struct ImageRequest {
    id: String,
    input: ImageInput,
    cancelled: Arc<AtomicBool>,
    epoch: u64,
}

impl ImageRequest {
    pub(crate) fn id(&self) -> &str {
        &self.id
    }
    pub(crate) fn input(&self) -> ImageInput {
        self.input.clone()
    }
    pub(crate) fn cancellation(&self) -> Arc<AtomicBool> {
        self.cancelled.clone()
    }
    pub(crate) fn epoch(&self) -> u64 {
        self.epoch
    }
}

#[derive(Default)]
pub(super) struct Images {
    pub(super) epoch: u64,
    loading: bool,
    entries: BTreeMap<String, Entry>,
}
struct Entry {
    input: Option<ImageInput>,
    phase: Phase,
    cancelled: Arc<AtomicBool>,
}
enum Phase {
    Pending,
    Ready(Arc<Image>),
    Failed(AppError),
}

impl RichTextEditorState {
    #[cfg(test)]
    pub(crate) fn image_cancellation(&self, id: &str) -> Option<Arc<AtomicBool>> {
        self.images
            .entries
            .get(id)
            .map(|entry| entry.cancelled.clone())
    }

    #[cfg(test)]
    pub(crate) fn retained_image_count(&self) -> usize {
        self.images.entries.len()
    }
    pub(crate) fn image_epoch(&self) -> u64 {
        self.images.epoch
    }
    pub(crate) fn has_pending_images(&self) -> bool {
        self.pending_paste.is_some()
            || self.images.loading
            || self
                .images
                .entries
                .values()
                .any(|entry| matches!(entry.phase, Phase::Pending))
    }
    pub(crate) fn has_failed_images(&self, cx: &App) -> bool {
        self.snapshot(cx).image_ids().is_ok_and(|ids| {
            ids.iter().any(|id| {
                self.images
                    .entries
                    .get(id)
                    .is_none_or(|entry| matches!(entry.phase, Phase::Failed(_)))
            })
        })
    }

    pub(super) fn reset_images(&mut self, cx: &mut Context<Self>) {
        self.release_images(cx);
        self.pending_paste = None;
        self.images.entries.clear();
        self.images.epoch += 1;
        self.images.loading = self.document.image_ids().is_ok_and(|ids| !ids.is_empty());
        self.refresh_visible_images(cx);
    }

    pub(super) fn release_images(&self, cx: &mut App) {
        if let Some(paste) = &self.pending_paste {
            paste.cancelled.store(true, Ordering::Release);
        }
        for entry in self.images.entries.values() {
            entry.cancelled.store(true, Ordering::Release);
            if let Phase::Ready(preview) = &entry.phase {
                preview.clone().remove_asset(cx);
            }
        }
    }

    pub(crate) fn set_image_previews(
        &mut self,
        epoch: u64,
        result: AppResult<Vec<(String, Option<Arc<Image>>)>>,
        cx: &mut Context<Self>,
    ) {
        if epoch != self.images.epoch {
            return;
        }
        self.images.loading = false;
        let ids = self.snapshot(cx).image_ids().unwrap_or_default();
        match result {
            Ok(previews) => {
                for (id, preview) in previews {
                    self.images.entries.insert(
                        id,
                        Entry {
                            input: None,
                            phase: preview.map_or_else(
                                || Phase::Failed(images::error("missing")),
                                Phase::Ready,
                            ),
                            cancelled: Arc::new(AtomicBool::new(false)),
                        },
                    );
                }
            }
            Err(error) => {
                for id in ids {
                    self.images.entries.entry(id).or_insert(Entry {
                        input: None,
                        phase: Phase::Failed(error.clone()),
                        cancelled: Arc::new(AtomicBool::new(false)),
                    });
                }
            }
        }
        self.refresh_visible_images(cx);
        cx.emit(RichTextEvent::ResourcesSettled);
        cx.notify();
    }

    pub(super) fn insert_image(
        &mut self,
        input: ImageInput,
        captured: Result<CapturedRange, CapturedRangeError>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.readonly || self.has_pending_images() {
            self.error = Some(images::error("one_at_a_time"));
            cx.notify();
            return;
        }
        let Some(captured) = captured.ok() else {
            self.error = Some(images::error("position"));
            cx.notify();
            return;
        };
        let retained: usize = self
            .images
            .entries
            .values()
            .filter_map(|entry| entry.input.as_ref())
            .map(ImageInput::retained_bytes)
            .sum();
        if retained + input.retained_bytes() > mftp_image::MAX_INPUT_BYTES
            || self.images.entries.len() >= 32
        {
            self.report_image_error(images::error("limit"), window, cx);
            return;
        }
        if self
            .snapshot(cx)
            .image_ids()
            .is_ok_and(|ids| ids.len() >= document::MAX_IMAGES)
        {
            self.report_image_error(images::error("limit"), window, cx);
            return;
        }
        let id = uuid::Uuid::new_v4().to_string();
        let uri = format!("mftp-image:{id}");
        let inserted = self.editor.update(cx, |editor, cx| {
            editor.insert_image(&captured, &uri, &text("rich_text.image", self.locale), cx)
        });
        if !inserted {
            self.error = Some(images::error("position"));
            cx.notify();
            return;
        }
        self.images.entries.insert(
            id.clone(),
            Entry {
                input: Some(input),
                phase: Phase::Pending,
                cancelled: Arc::new(AtomicBool::new(false)),
            },
        );
        self.error = None;
        self.emit_image_request(&id, cx);
        cx.notify();
    }

    fn emit_image_request(&self, id: &str, cx: &mut Context<Self>) {
        if let Some(entry) = self.images.entries.get(id)
            && let Some(input) = entry.input.clone()
        {
            cx.emit(RichTextEvent::ImportImage(ImageRequest {
                id: id.to_owned(),
                input,
                cancelled: entry.cancelled.clone(),
                epoch: self.images.epoch,
            }));
        }
    }

    pub(crate) fn resolve_image(
        &mut self,
        epoch: u64,
        id: &str,
        result: AppResult<Arc<Image>>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if epoch != self.images.epoch {
            return;
        }
        let rejection = result
            .as_ref()
            .err()
            .filter(|error| is_limit_error(error))
            .cloned();
        if let Some(entry) = self.images.entries.get_mut(id) {
            entry.phase = match result {
                Ok(preview) => {
                    entry.input = None;
                    Phase::Ready(preview)
                }
                Err(error) => Phase::Failed(error),
            };
        }
        self.refresh_visible_images(cx);
        if let Some(error) = rejection
            && self
                .snapshot(cx)
                .image_ids()
                .is_ok_and(|ids| ids.iter().any(|image| image == id))
        {
            self.report_image_error(error, window, cx);
        }
        cx.emit(RichTextEvent::ResourcesSettled);
        cx.notify();
    }

    pub(super) fn reconcile_images(&mut self, cx: &mut Context<Self>) {
        if let Ok(ids) = self.snapshot(cx).image_ids() {
            for (id, entry) in &self.images.entries {
                if !ids.contains(id) && matches!(entry.phase, Phase::Pending) {
                    entry.cancelled.store(true, Ordering::Release);
                }
            }
        }
    }

    fn refresh_visible_images(&self, cx: &mut Context<Self>) {
        let urls = self
            .images
            .entries
            .iter()
            .filter(|(_, entry)| matches!(entry.phase, Phase::Ready(_)))
            .map(|(id, _)| format!("mftp-image:{id}"))
            .collect();
        self.editor
            .update(cx, |editor, cx| editor.set_visible_images(urls, cx));
    }

    pub(super) fn image_resolver(
        &self,
    ) -> impl Fn(&gpui_kit::SharedUri) -> ImageSource + Send + Sync + 'static {
        let images: BTreeMap<_, _> = self
            .images
            .entries
            .iter()
            .filter_map(|(id, entry)| match &entry.phase {
                Phase::Ready(preview) => Some((id.clone(), preview.clone())),
                _ => None,
            })
            .collect();
        move |uri| {
            document::image_id(uri.as_ref())
                .and_then(|id| images.get(id))
                .map_or_else(
                    || ImageSource::Custom(Arc::new(|_, _| None)),
                    |preview| ImageSource::Image(preview.clone()),
                )
        }
    }

    pub(super) fn choose_image(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.readonly || self.has_pending_images() {
            return;
        }
        let captured = self.editor.read(cx).capture_selection();
        let epoch = self.images.epoch;
        let selection = cx.prompt_for_paths(gpui_kit::PathPromptOptions {
            files: true,
            directories: false,
            multiple: false,
            prompt: Some(
                text("rich_text.insert_image", self.locale)
                    .into_owned()
                    .into(),
            ),
        });
        cx.spawn_in(window, async move |this, cx| {
            let selected = selection.await;
            let _ = this.update_in(cx, |this, window, cx| {
                if this.images.epoch != epoch {
                    return;
                }
                match selected {
                    Ok(Ok(Some(paths))) => {
                        if let Some(path) = paths.into_iter().next() {
                            this.insert_image(ImageInput::from_path(path), captured, window, cx);
                        }
                    }
                    Ok(Ok(None)) => {}
                    _ => {
                        this.error = Some(images::error("read_failed"));
                        cx.notify();
                    }
                }
                this.focus(window, cx);
            });
        })
        .detach();
    }

    pub(super) fn render_image_status(&self, cx: &mut Context<Self>) -> Vec<gpui_kit::AnyElement> {
        if self.images.loading || self.pending_paste.is_some() {
            return vec![
                div()
                    .flex()
                    .gap_2()
                    .child(Spinner::new().small())
                    .child(text("rich_text.image_processing", self.locale).into_owned())
                    .into_any_element(),
            ];
        }
        let ids = self.snapshot(cx).image_ids().unwrap_or_default();
        ids.into_iter()
            .filter_map(|id| {
                let entry = self.images.entries.get(&id)?;
                if matches!(entry.phase, Phase::Ready(_)) {
                    return None;
                }
                let key = match &entry.phase {
                    Phase::Pending => "rich_text.image_processing",
                    Phase::Failed(error) if is_limit_error(error) => "rich_text.image_rejected",
                    Phase::Failed(error) => error_key(error),
                    _ => return None,
                };
                let mut row = div()
                    .id(gpui_kit::SharedString::from(format!(
                        "rich-text-image-status:{id}"
                    )))
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .gap_2()
                    .text_color(if matches!(entry.phase, Phase::Failed(_)) {
                        cx.theme().danger
                    } else {
                        cx.theme().muted_foreground
                    })
                    .child(text(key, self.locale).into_owned());
                if matches!(entry.phase, Phase::Pending) {
                    row = row.child(Spinner::new().small());
                }
                if matches!(&entry.phase, Phase::Failed(error) if !is_limit_error(error)) {
                    let id = id.clone();
                    row = row.child(
                        Button::new(gpui_kit::SharedString::from(format!(
                            "rich-text-image-retry:{id}"
                        )))
                        .small()
                        .ghost()
                        .disabled(self.readonly)
                        .label(text("rich_text.image_retry", self.locale).into_owned())
                        .on_click(cx.listener(move |this, _, _, cx| {
                            if this.has_pending_images() {
                                return;
                            }
                            if this
                                .images
                                .entries
                                .get(&id)
                                .is_some_and(|entry| entry.input.is_none())
                            {
                                this.images.loading = true;
                                cx.emit(RichTextEvent::ReloadImages);
                                cx.notify();
                                return;
                            }
                            if let Some(entry) = this.images.entries.get_mut(&id) {
                                entry.phase = Phase::Pending;
                                entry.cancelled = Arc::new(AtomicBool::new(false));
                            }
                            this.emit_image_request(&id, cx);
                            cx.notify();
                        })),
                    );
                }
                let uri = format!("mftp-image:{id}");
                row = row.child(
                    Button::new(gpui_kit::SharedString::from(format!(
                        "rich-text-image-remove:{id}"
                    )))
                    .small()
                    .ghost()
                    .disabled(self.readonly)
                    .label(text("rich_text.image_remove", self.locale).into_owned())
                    .on_click(cx.listener(move |this, _, window, cx| {
                        this.editor
                            .update(cx, |editor, cx| editor.remove_image(&uri, cx));
                        this.focus(window, cx);
                    })),
                );
                Some(row.into_any_element())
            })
            .collect()
    }

    pub(super) fn report_image_error(
        &mut self,
        error: AppError,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if is_limit_error(&error) {
            window.push_notification(
                Notification::warning(text(error_key(&error), self.locale).into_owned())
                    .placement(Anchor::TopCenter)
                    .delivery(NotificationDelivery::InApp)
                    .id1::<Self>(("rich-text-image-rejection", cx.entity().entity_id())),
                cx,
            );
        } else {
            self.error = Some(error);
        }
        cx.notify();
    }
}

fn is_limit_error(error: &AppError) -> bool {
    matches!(
        error.code.as_str(),
        "native:image_input_too_large"
            | "native:image_dimensions"
            | "native:image_limit"
            | "native:image_output_too_large"
    )
}

pub(super) fn error_key(error: &AppError) -> &'static str {
    match error.code.as_str() {
        "native:image_input_too_large" => "rich_text.image_input_too_large",
        "native:image_dimensions" => "rich_text.image_dimensions",
        "native:image_unsupported" => "rich_text.image_unsupported",
        "native:image_limit" => "rich_text.image_limit",
        "native:image_output_too_large" => "rich_text.image_output_too_large",
        "native:image_one_at_a_time" => "rich_text.image_one_at_a_time",
        "native:image_missing" => "rich_text.image_missing",
        "native:image_position" => "rich_text.image_position",
        _ => "rich_text.image_failed",
    }
}
