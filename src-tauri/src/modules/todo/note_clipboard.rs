use std::io::Cursor;

use arboard::{Clipboard, Error as ClipboardError};
use base64::{engine::general_purpose::STANDARD, Engine};

use super::note_model::TodoNoteClipboard;
use super::note_service::TodoNoteService;
use crate::error::{AppError, AppResult, CustomErrorCode};

fn clipboard_error(error: ClipboardError) -> AppError {
    AppError::external("todo:clipboard_read", error.to_string())
}

pub(super) fn read(
    notes: &TodoNoteService,
    draft_id: &str,
    text_only: bool,
) -> AppResult<TodoNoteClipboard> {
    let mut clipboard = Clipboard::new().map_err(clipboard_error)?;
    if !text_only {
        match clipboard.get_image() {
            Ok(image) => {
                if image.width > 8_192 || image.height > 8_192 {
                    return Err(AppError::custom(CustomErrorCode::TodoNoteImageDimensions));
                }
                if image.width.saturating_mul(image.height) > 12_000_000 {
                    return Err(AppError::custom(CustomErrorCode::TodoNoteImagePixels));
                }
                if image.width == 0 || image.height == 0 {
                    return Err(AppError::custom(CustomErrorCode::TodoNoteImageInvalid));
                }
                let image = image::RgbaImage::from_raw(
                    image.width as u32,
                    image.height as u32,
                    image.bytes.into_owned(),
                )
                .ok_or_else(|| AppError::custom(CustomErrorCode::TodoNoteImageUnsupported))?;
                let mut png = Cursor::new(Vec::new());
                image::DynamicImage::ImageRgba8(image)
                    .write_to(&mut png, image::ImageFormat::Png)
                    .map_err(|_| AppError::custom(CustomErrorCode::TodoNoteImageUnsupported))?;
                let image = notes
                    .import_image(draft_id, &STANDARD.encode(png.into_inner()))?
                    .image;
                return Ok(TodoNoteClipboard::Image { image });
            }
            Err(ClipboardError::ContentNotAvailable) => {}
            Err(error) => return Err(clipboard_error(error)),
        }
    }
    match clipboard.get_text() {
        Ok(text) => Ok(TodoNoteClipboard::Text { text }),
        Err(ClipboardError::ContentNotAvailable) => Ok(TodoNoteClipboard::Empty),
        Err(error) => Err(clipboard_error(error)),
    }
}
