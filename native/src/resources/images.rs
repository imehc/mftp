//! Raw bytes and file handles stay in transient imports, never document snapshots.
use gpui_kit::{ClipboardEntry, ClipboardItem, Image, ImageFormat};
use mftp_foundation::{AppError, AppResult};
use mftp_image::{MAX_INPUT_BYTES, PrepareImageError, PreparedImage};
use std::{
    io::Read,
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

pub(crate) type ImagePreviews = Vec<(String, Option<Arc<Image>>)>;

#[derive(Clone)]
pub(crate) struct ImageInput {
    source: Source,
}

#[derive(Clone)]
enum Source {
    Bytes(Arc<[u8]>),
    File(PathBuf),
}

impl ImageInput {
    pub(crate) fn from_path(path: PathBuf) -> Self {
        Self {
            source: Source::File(path),
        }
    }

    pub(crate) fn from_clipboard(item: &ClipboardItem) -> AppResult<Option<Self>> {
        if let Some(image) = item.entries().iter().find_map(|entry| match entry {
            ClipboardEntry::Image(image) => Some(image),
            _ => None,
        }) {
            if image.bytes.len() > MAX_INPUT_BYTES {
                return Err(error("input_too_large"));
            }
            return Ok(Some(Self {
                source: Source::Bytes(image.bytes.clone().into()),
            }));
        }
        if let Some(paths) = item.entries().iter().find_map(|entry| match entry {
            ClipboardEntry::ExternalPaths(paths) => Some(&paths.0),
            _ => None,
        }) {
            if paths.len() != 1 {
                return Err(error("one_at_a_time"));
            }
            return Ok(paths.first().cloned().map(Self::from_path));
        }
        Ok(None)
    }

    pub(crate) fn retained_bytes(&self) -> usize {
        match &self.source {
            Source::Bytes(bytes) => bytes.len(),
            Source::File(_) => 0,
        }
    }

    pub(crate) fn prepare(&self, cancelled: &AtomicBool) -> AppResult<PreparedImage> {
        if cancelled.load(Ordering::Acquire) {
            return Err(error("cancelled"));
        }
        let bytes = match &self.source {
            Source::Bytes(bytes) => bytes.clone(),
            Source::File(path) => {
                let file = std::fs::File::open(path).map_err(|_| error("read_failed"))?;
                if file.metadata().map_err(|_| error("read_failed"))?.len() > MAX_INPUT_BYTES as u64
                {
                    return Err(error("input_too_large"));
                }
                let mut bytes = Vec::new();
                file.take(MAX_INPUT_BYTES as u64 + 1)
                    .read_to_end(&mut bytes)
                    .map_err(|_| error("read_failed"))?;
                if bytes.len() > MAX_INPUT_BYTES {
                    return Err(error("input_too_large"));
                }
                bytes.into()
            }
        };
        mftp_image::prepare_image(&bytes, || cancelled.load(Ordering::Acquire))
            .map_err(prepare_error)
    }
}

pub(crate) fn preview(prepared: &PreparedImage) -> Arc<Image> {
    let thumbnail = prepared.thumbnail();
    let format = match thumbnail.format() {
        image_format if image_format.to_mime_type() == "image/jpeg" => ImageFormat::Jpeg,
        image_format if image_format.to_mime_type() == "image/png" => ImageFormat::Png,
        _ => ImageFormat::Webp,
    };
    Arc::new(Image::from_bytes(format, thumbnail.bytes().to_vec()))
}

pub(crate) fn prepare_error(error: PrepareImageError) -> AppError {
    let code = match error {
        PrepareImageError::Cancelled => "cancelled",
        PrepareImageError::InputTooLarge => "input_too_large",
        PrepareImageError::PixelLimit
        | PrepareImageError::EdgeLimit
        | PrepareImageError::DecodeLimit => "dimensions",
        PrepareImageError::UnsupportedFormat | PrepareImageError::AnimatedImage => "unsupported",
        PrepareImageError::OutputTooLarge => "output_too_large",
        PrepareImageError::Codec(_) => "corrupt",
    };
    self::error(code)
}

pub(crate) fn error(code: &str) -> AppError {
    let code = match code {
        "cancelled" => "native:image_cancelled",
        "input_too_large" => "native:image_input_too_large",
        "one_at_a_time" => "native:image_one_at_a_time",
        "read_failed" => "native:image_read_failed",
        "dimensions" => "native:image_dimensions",
        "unsupported" => "native:image_unsupported",
        "output_too_large" => "native:image_output_too_large",
        "corrupt" => "native:image_corrupt",
        "schema_invalid" => "native:image_schema_invalid",
        "limit" => "native:image_limit",
        "missing" => "native:image_missing",
        "position" => "native:image_position",
        _ => "native:image_failed",
    };
    AppError::external(code, "Native image import could not complete")
}
