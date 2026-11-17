//! Host resource admissions keep semantic pastes tied to the original selection.
use super::{RichTextDocument, RichTextEditorState, RichTextEvent};
use crate::{i18n::text, resources::images};
use gpui_kit::{
    AnyElement, ClipboardItem, Context, InteractiveElement, IntoElement, ParentElement, Styled,
    Window,
    component::{
        IconName,
        menu::{ContextMenuExt, PopupMenuItem},
    },
};
use markdown_editor::PasteRequest;
use mftp_foundation::AppResult;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

#[derive(Clone)]
pub struct PasteImagesRequest {
    pub(crate) request: PasteRequest,
    pub(crate) source: String,
    pub(crate) epoch: u64,
    pub(crate) cancelled: Arc<AtomicBool>,
}

impl RichTextEditorState {
    pub(crate) fn resolve_image_copy(
        &mut self,
        epoch: u64,
        result: AppResult<Arc<gpui_kit::Image>>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if epoch != self.images.epoch {
            return;
        }
        match result {
            Ok(image) => cx.write_to_clipboard(ClipboardItem::new_image(&image)),
            Err(error) => self.report_image_error(error, window, cx),
        }
    }

    pub(super) fn intercept_image_paste(
        &mut self,
        request: &PasteRequest,
        item: &ClipboardItem,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        if request.is_plain()
            || !item.metadata().is_some_and(|tag| {
                matches!(
                    tag.as_str(),
                    "gpui-kit/block-editor/inline-markdown/v1"
                        | "gpui-kit/block-editor/blocks-markdown/v1"
                )
            })
        {
            return false;
        }
        let Some(source) = item.text() else {
            return false;
        };
        let incoming = RichTextDocument::from_markdown(&source);
        let Ok(ids) = incoming.image_ids() else {
            return false;
        };
        if ids.is_empty() {
            return false;
        }
        let combined =
            RichTextDocument::from_markdown(format!("{}\n{}", self.snapshot(cx).source(), source));
        if self.has_pending_images() || combined.validate().is_err() {
            self.editor.update(cx, |editor, cx| {
                editor.apply_paste(request, None, cx);
            });
            self.report_image_error(
                images::error(if self.has_pending_images() {
                    "one_at_a_time"
                } else {
                    "limit"
                }),
                window,
                cx,
            );
            return true;
        }
        let transfer = PasteImagesRequest {
            request: request.clone(),
            source,
            epoch: self.images.epoch,
            cancelled: Arc::new(AtomicBool::new(false)),
        };
        self.pending_paste = Some(transfer.clone());
        cx.emit(RichTextEvent::PasteImages(transfer));
        cx.notify();
        true
    }

    pub(super) fn cancel_stale_paste(&self, cx: &gpui_kit::App) {
        if let Some(paste) = &self.pending_paste
            && !self.editor.read(cx).is_paste_current(&paste.request)
        {
            paste.cancelled.store(true, Ordering::Release);
        }
    }

    pub(crate) fn resolve_image_paste(
        &mut self,
        transfer: &PasteImagesRequest,
        result: AppResult<(String, images::ImagePreviews)>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        if self.images.epoch != transfer.epoch {
            return false;
        }
        self.pending_paste = None;
        let mut accepted = false;
        match result {
            Ok((source, previews)) => {
                let applied = self.editor.update(cx, |editor, cx| {
                    editor.apply_paste(&transfer.request, Some(&source), cx)
                });
                if applied {
                    self.set_image_previews(transfer.epoch, Ok(previews), cx);
                    accepted = true;
                } else {
                    self.report_image_error(images::error("position"), window, cx);
                }
            }
            Err(error) => {
                self.editor.update(cx, |editor, cx| {
                    editor.apply_paste(&transfer.request, None, cx);
                });
                self.report_image_error(
                    if error.code == "native:image_cancelled" {
                        images::error("position")
                    } else {
                        error
                    },
                    window,
                    cx,
                );
            }
        }
        cx.emit(RichTextEvent::ResourcesSettled);
        cx.notify();
        accepted
    }

    pub(super) fn with_image_menu<E>(&self, view: E, cx: &Context<Self>) -> AnyElement
    where
        E: IntoElement + InteractiveElement + ParentElement + Styled + 'static,
    {
        let ids = self.document.image_ids().unwrap_or_default();
        if ids.is_empty() {
            return view.into_any_element();
        }
        let owner = cx.weak_entity();
        let epoch = self.images.epoch;
        let locale = self.locale;
        view.context_menu(move |mut menu, _, _| {
            for (index, id) in ids.iter().enumerate() {
                let owner = owner.clone();
                let id = id.clone();
                let label = if ids.len() == 1 {
                    text("rich_text.copy_image", locale).into_owned()
                } else {
                    rust_i18n::t!(
                        "rich_text.copy_image_number",
                        locale = locale.as_str(),
                        number = index + 1
                    )
                    .into_owned()
                };
                menu = menu.item(PopupMenuItem::new(label).icon(IconName::Copy).on_click(
                    move |_, window, cx| {
                        let owner = owner.clone();
                        let id = id.clone();
                        window.defer(cx, move |_, cx| {
                            let _ = owner.update(cx, |state, cx| {
                                if state.images.epoch == epoch {
                                    cx.emit(RichTextEvent::CopyImage { id, epoch });
                                }
                            });
                        });
                    },
                ));
            }
            menu
        })
        .into_any_element()
    }
}
