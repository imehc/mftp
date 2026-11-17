//! Native rich text owns editing behavior, never feature persistence.

mod clipboard;
mod document;
mod images;
mod links;
#[cfg(test)]
mod tests;
mod toolbar;
mod toolbar_menu;

pub use clipboard::PasteImagesRequest;
pub use document::{MAX_DOCUMENT_BYTES, RichTextDocument};
pub use images::ImageRequest;

pub fn init(cx: &mut gpui_kit::App) {
    markdown_editor::init(cx);
    cx.bind_keys([gpui_kit::KeyBinding::new(
        "escape",
        gpui_kit::base::input::Escape,
        Some("BlockEditor"),
    )]);
}
use crate::i18n::{Locale, text};
use gpui_kit::{
    App, AppContext, Context, Entity, EventEmitter, IntoElement, Render, Role, ScrollHandle,
    Subscription, TestSupportExt, Window,
    component::{ActiveTheme, ElementExt, text::TextView},
    div,
    prelude::*,
};
use markdown_editor::{
    BlockEditor, BlockEditorEvent, BlockEditorState, ClipboardPolicy, ImagePolicy,
};
use mftp_foundation::{AppError, AppResult};
use unicode_segmentation::UnicodeSegmentation;

pub enum RichTextEvent {
    Changed,
    OpenLink(String),
    ImportImage(ImageRequest),
    ResourcesSettled,
    ReloadImages,
    PasteImages(PasteImagesRequest),
    CopyImage { id: String, epoch: u64 },
}

pub struct RichTextEditorState {
    editor: Entity<BlockEditorState>,
    document: RichTextDocument,
    locale: Locale,
    label: String,
    readonly: bool,
    loaded_revision: u64,
    error: Option<AppError>,
    scroll: ScrollHandle,
    subscription: Subscription,
    images: images::Images,
    image_release: Subscription,
    character_count: usize,
    expanded_toolbar: bool,
    pending_paste: Option<PasteImagesRequest>,
}

impl EventEmitter<RichTextEvent> for RichTextEditorState {}

impl RichTextEditorState {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let scroll = ScrollHandle::new();
        let editor = cx.new(|cx| {
            let mut state = BlockEditorState::new(window, cx)
                .with_image_policy(ImagePolicy::Load)
                .with_clipboard_policy(ClipboardPolicy::Host);
            state.set_scroll_handle(scroll.clone());
            state
        });
        let subscription =
            cx.subscribe_in(
                &editor,
                window,
                |this, editor, event, window, cx| match event {
                    BlockEditorEvent::Changed { .. } => {
                        this.document = RichTextDocument::from_markdown(editor.read(cx).source());
                        this.update_character_count(cx);
                        this.error = this.document.validate().err();
                        this.reconcile_images(cx);
                        this.cancel_stale_paste(cx);
                        cx.emit(RichTextEvent::Changed);
                        cx.notify();
                    }
                    BlockEditorEvent::SelectionChanged => {
                        this.cancel_stale_paste(cx);
                        cx.notify();
                    }
                    BlockEditorEvent::EditLinkRequested { url } => {
                        this.edit_link(url.as_ref().map(|url| url.to_string()), window, cx);
                    }
                    BlockEditorEvent::LinkClicked { url } => {
                        if links::valid_url(url) {
                            cx.emit(RichTextEvent::OpenLink(url.to_string()));
                        }
                    }
                    BlockEditorEvent::PasteRequested { request, item } => {
                        if this.intercept_image_paste(request, item, window, cx) {
                            return;
                        }
                        let image = crate::resources::images::ImageInput::from_clipboard(item);
                        if let Ok(Some(input)) = image {
                            let captured = editor.read(cx).capture_selection();
                            if editor.read(cx).is_paste_current(request) {
                                editor.update(cx, |editor, cx| {
                                    editor.apply_paste(request, None, cx);
                                });
                                this.insert_image(input, captured, window, cx);
                            }
                        } else if let Err(error) = image {
                            this.report_image_error(error, window, cx);
                        } else if let Some(content) = item.text() {
                            if content.len() + this.document.source().len() > MAX_DOCUMENT_BYTES {
                                this.error =
                                    Some(document::invalid("Paste exceeds document budget"));
                            } else {
                                let current = editor.update(cx, |editor, cx| {
                                    editor.apply_paste(request, Some(&content), cx)
                                });
                                if !current {
                                    this.error = Some(document::invalid(
                                        "Paste selection is no longer current",
                                    ));
                                }
                            }
                        } else {
                            this.error = Some(crate::resources::images::error("unsupported"));
                        }
                        cx.notify();
                    }
                    _ => {}
                },
            );
        let image_release = cx.on_release(|this, cx| this.release_images(cx));
        Self {
            editor,
            document: RichTextDocument::default(),
            locale: Locale::English,
            label: String::new(),
            readonly: false,
            loaded_revision: 0,
            error: None,
            scroll,
            subscription,
            images: images::Images::default(),
            image_release,
            character_count: 0,
            expanded_toolbar: false,
            pending_paste: None,
        }
    }

    pub fn document(&self) -> &RichTextDocument {
        &self.document
    }

    /// Snapshot the input immediately, before a queued Changed event is delivered.
    pub fn snapshot(&self, cx: &App) -> RichTextDocument {
        let editor = self.editor.read(cx);
        if editor.model().revision() == self.loaded_revision {
            self.document.clone()
        } else {
            RichTextDocument::from_markdown(editor.source())
        }
    }

    pub fn set_document(
        &mut self,
        document: RichTextDocument,
        cx: &mut Context<Self>,
    ) -> AppResult<()> {
        if !document.is_supported_version() || document.source().len() > 2 * 1024 * 1024 {
            return Err(document::invalid(
                "Unsupported or oversized editing snapshot",
            ));
        }
        self.editor
            .update(cx, |editor, cx| editor.set_source(document.source(), cx))
            .map_err(|_| document::invalid("Document cannot be opened"))?;
        self.document = document;
        self.update_character_count(cx);
        self.reset_images(cx);
        self.loaded_revision = self.editor.read(cx).model().revision();
        self.error = self.document.validate().err();
        cx.notify();
        Ok(())
    }

    pub fn set_presentation(
        &mut self,
        locale: Locale,
        label: String,
        readonly: bool,
        cx: &mut Context<Self>,
    ) {
        self.locale = locale;
        self.label = label;
        if self.readonly != readonly {
            self.readonly = readonly;
            self.editor
                .update(cx, |editor, cx| editor.set_readonly(readonly, cx));
        }
        cx.notify();
    }

    pub fn is_composing(&self, cx: &App) -> bool {
        self.editor.read(cx).is_composing()
    }

    pub fn value(&self, cx: &App) -> String {
        self.editor
            .read(cx)
            .model()
            .document()
            .leaves()
            .filter_map(|block| block.text())
            .map(|text| text.replace('\u{fffc}', ""))
            .collect::<Vec<_>>()
            .join("\n")
    }

    /// Count visible text graphemes, excluding whitespace and image placeholders.
    pub fn character_count(&self) -> usize {
        self.character_count
    }

    fn update_character_count(&mut self, cx: &App) {
        self.character_count = self
            .value(cx)
            .graphemes(true)
            .filter(|grapheme| !grapheme.chars().all(char::is_whitespace))
            .count();
    }

    pub fn focus(&self, window: &mut Window, cx: &mut App) {
        self.editor
            .update(cx, |editor, cx| editor.focus(window, cx));
    }

    #[cfg(test)]
    pub(crate) fn input_id(&self) -> gpui_kit::ElementId {
        ("block-editor", self.editor.entity_id()).into()
    }
}

impl Render for RichTextEditorState {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if self.readonly {
            let view = div().id("rich-text-reader").test_support().min_w_0().child(
                TextView::markdown(
                    ("rich-text-reading", cx.entity_id()),
                    self.document.source().to_owned(),
                )
                .image_source(self.image_resolver())
                .selectable(true)
                .scrollable(false)
                .on_link_click(|url, _, _, cx| {
                    if links::valid_url(url) {
                        cx.open_url(url);
                    }
                }),
            );
            return self.with_image_menu(view, cx);
        }
        // Keep the subscription owned for as long as this editor exists.
        let _ = (&self.subscription, &self.image_release);
        let view = div()
            .id("rich-text-editor")
            .test_support()
            .min_w_0()
            .min_h_0()
            .flex_1()
            .flex()
            .flex_col()
            .gap_2()
            .on_action(
                cx.listener(|this, _: &gpui_kit::base::input::Escape, window, cx| {
                    if this.is_composing(cx) {
                        this.editor.update(cx, |editor, cx| {
                            gpui_kit::EntityInputHandler::unmark_text(editor, window, cx)
                        });
                        cx.stop_propagation();
                    }
                }),
            )
            .child(
                div()
                    .id("rich-text-surface")
                    .test_support()
                    .flex()
                    .flex_col()
                    .min_w_0()
                    .min_h_0()
                    .flex_1()
                    .border_1()
                    .border_color(cx.theme().border)
                    .rounded(cx.theme().radius)
                    .on_prepaint({
                        let owner = cx.weak_entity();
                        move |bounds, window, cx| {
                            // The editor pane, rather than the window, owns overflow admission.
                            let expanded = bounds.size.width
                                >= gpui_kit::rems(28.).to_pixels(window.rem_size());
                            let _ = owner.update(cx, |owner, cx| {
                                if owner.expanded_toolbar != expanded {
                                    owner.expanded_toolbar = expanded;
                                    cx.notify();
                                }
                            });
                        }
                    })
                    .when(!self.readonly, |view| {
                        view.child(
                            div()
                                .flex_shrink_0()
                                .border_b_1()
                                .border_color(cx.theme().border)
                                .child(self.render_toolbar(cx)),
                        )
                    })
                    .child(
                        div()
                            .id("rich-text-scroll")
                            .test_support()
                            .min_w_0()
                            .min_h(gpui_kit::rems(4.))
                            .flex_1()
                            .overflow_y_scroll()
                            .track_scroll(&self.scroll)
                            .child(
                                BlockEditor::new(&self.editor)
                                    .image_source(self.image_resolver())
                                    .aria_label(self.label.clone())
                                    .min_h(gpui_kit::relative(1.))
                                    .p_3(),
                            ),
                    ),
            )
            .children(self.render_image_status(cx))
            .when_some(self.error.as_ref(), |view, error| {
                let key = if error.code.starts_with("native:image_") {
                    images::error_key(error)
                } else {
                    "rich_text.invalid"
                };
                view.child(
                    div()
                        .id("rich-text-error")
                        .test_support()
                        .role(Role::Alert)
                        .aria_label(text(key, self.locale).into_owned())
                        .text_color(cx.theme().danger)
                        .child(text(key, self.locale).into_owned()),
                )
            });
        self.with_image_menu(view, cx)
    }
}

/// Retained reading surface; construction and document replacement happen outside render.
pub struct RichTextView {
    state: Entity<RichTextEditorState>,
}

impl RichTextView {
    pub fn new(
        document: RichTextDocument,
        locale: Locale,
        label: String,
        window: &mut Window,
        cx: &mut App,
    ) -> AppResult<Self> {
        let state = cx.new(|cx| RichTextEditorState::new(window, cx));
        state.update(cx, |state, cx| {
            state.set_document(document, cx)?;
            state.set_presentation(locale, label, true, cx);
            Ok::<_, AppError>(())
        })?;
        Ok(Self { state })
    }
}

impl gpui_kit::IntoElement for RichTextView {
    type Element = <Entity<RichTextEditorState> as IntoElement>::Element;
    fn into_element(self) -> Self::Element {
        self.state.into_element()
    }
}
