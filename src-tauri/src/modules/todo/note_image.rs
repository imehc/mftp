use std::io::{Cursor, Write};

use image::codecs::{jpeg::JpegEncoder, png::PngDecoder, webp::WebPDecoder};
use image::metadata::Orientation;
use image::{DynamicImage, ImageDecoder, ImageError, ImageFormat, ImageReader, Limits};

pub(super) const MAX_IMAGE_BYTES: usize = 500_000;
pub(super) const MAX_INPUT_BYTES: usize = 20_000_000;
pub(super) const MAX_PIXELS: u64 = 12_000_000;
pub(super) const MAX_EDGE: u32 = 8_192;
pub(super) const MAX_THUMBNAIL_BYTES: usize = 50_000;
const MAX_DECODE_BYTES: u64 = 96 * 1024 * 1024;
const MAX_ENCODING_STEPS: usize = 12;

#[derive(Debug)]
pub(super) enum NoteImageError {
    Cancelled,
    InputTooLarge,
    UnsupportedFormat,
    AnimatedImage,
    DecodeLimit,
    PixelLimit,
    EdgeLimit,
    OutputTooLarge,
    Codec(ImageError),
}

impl From<ImageError> for NoteImageError {
    fn from(error: ImageError) -> Self {
        if matches!(error, ImageError::Limits(_)) {
            Self::DecodeLimit
        } else {
            Self::Codec(error)
        }
    }
}

#[derive(Debug)]
pub(super) struct EncodedNoteImage {
    pub bytes: Vec<u8>,
    pub format: ImageFormat,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug)]
pub(super) struct PreparedNoteImage {
    pub image: EncodedNoteImage,
    pub thumbnail: EncodedNoteImage,
    pub compressed: bool,
}

struct CappedBuffer {
    bytes: Vec<u8>,
    limit: usize,
    exceeded: bool,
}

impl CappedBuffer {
    fn new(limit: usize) -> Self {
        Self {
            bytes: Vec::new(),
            limit,
            exceeded: false,
        }
    }
}

impl Write for CappedBuffer {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if bytes.len() > self.limit.saturating_sub(self.bytes.len()) {
            self.exceeded = true;
            return Err(std::io::Error::new(
                std::io::ErrorKind::FileTooLarge,
                "Encoded todo image exceeds its byte budget",
            ));
        }
        self.bytes.extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn check_cancelled(cancelled: &impl Fn() -> bool) -> Result<(), NoteImageError> {
    if cancelled() {
        Err(NoteImageError::Cancelled)
    } else {
        Ok(())
    }
}

fn decode(bytes: &[u8]) -> Result<(DynamicImage, ImageFormat, Orientation), NoteImageError> {
    if bytes.len() > MAX_INPUT_BYTES {
        return Err(NoteImageError::InputTooLarge);
    }
    let format = image::guess_format(bytes).map_err(|_| NoteImageError::UnsupportedFormat)?;
    if !matches!(
        format,
        ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::WebP
    ) {
        return Err(NoteImageError::UnsupportedFormat);
    }
    // Read dimensions before decoder allocation or compression, including direct IPC imports.
    let mut header_limits = Limits::default();
    header_limits.max_alloc = Some(MAX_DECODE_BYTES);
    let mut header = ImageReader::with_format(Cursor::new(bytes), format);
    header.limits(header_limits);
    let (width, height) = header.into_dimensions()?;
    if width > MAX_EDGE || height > MAX_EDGE {
        return Err(NoteImageError::EdgeLimit);
    }
    if u64::from(width) * u64::from(height) > MAX_PIXELS {
        return Err(NoteImageError::PixelLimit);
    }
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_EDGE);
    limits.max_image_height = Some(MAX_EDGE);
    limits.max_alloc = Some(MAX_DECODE_BYTES);
    match format {
        ImageFormat::Png
            if PngDecoder::with_limits(Cursor::new(bytes), limits.clone())?.is_apng()? =>
        {
            return Err(NoteImageError::AnimatedImage);
        }
        ImageFormat::WebP if WebPDecoder::new(Cursor::new(bytes))?.has_animation() => {
            return Err(NoteImageError::AnimatedImage);
        }
        _ => {}
    }
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    reader.limits(limits);
    let mut decoder = reader.into_decoder()?;
    let (width, height) = decoder.dimensions();
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > MAX_PIXELS {
        return Err(NoteImageError::DecodeLimit);
    }
    let orientation = decoder.orientation()?;
    let decoded = DynamicImage::from_decoder(decoder)?;
    Ok((decoded, format, orientation))
}

fn encode(
    image: &DynamicImage,
    format: ImageFormat,
    quality: u8,
    limit: usize,
) -> Result<Option<EncodedNoteImage>, NoteImageError> {
    let mut output = CappedBuffer::new(limit);
    let encoded = if format == ImageFormat::Jpeg {
        JpegEncoder::new_with_quality(&mut output, quality).encode_image(image)
    } else {
        image.write_with_encoder(image::codecs::webp::WebPEncoder::new_lossless(&mut output))
    };
    if output.exceeded {
        return Ok(None);
    }
    encoded?;
    Ok(Some(EncodedNoteImage {
        bytes: output.bytes,
        format,
        width: image.width(),
        height: image.height(),
    }))
}

fn fit_image(
    mut image: DynamicImage,
    limit: usize,
    cancelled: &impl Fn() -> bool,
) -> Result<EncodedNoteImage, NoteImageError> {
    check_cancelled(cancelled)?;
    if let Some(encoded) = encode(&image, ImageFormat::WebP, 100, limit)? {
        check_cancelled(cancelled)?;
        return Ok(encoded);
    }
    let transparent = image
        .as_rgba8()
        .is_some_and(|pixels| pixels.pixels().any(|pixel| pixel.0[3] < 255));
    if !transparent {
        image = DynamicImage::ImageRgb8(image.into_rgb8());
    }
    for step in 0..MAX_ENCODING_STEPS {
        check_cancelled(cancelled)?;
        if transparent {
            if step > 0 {
                if let Some(encoded) = encode(&image, ImageFormat::WebP, 100, limit)? {
                    check_cancelled(cancelled)?;
                    return Ok(encoded);
                }
            }
        } else {
            if let Some(encoded) = encode(&image, ImageFormat::Jpeg, 90, limit)? {
                check_cancelled(cancelled)?;
                return Ok(encoded);
            }
            check_cancelled(cancelled)?;
            if step == 0 {
                if let Some(encoded) = encode(&image, ImageFormat::Jpeg, 82, limit)? {
                    check_cancelled(cancelled)?;
                    return Ok(encoded);
                }
            }
        }
        check_cancelled(cancelled)?;
        let width = (image.width() * 3 / 4).max(1);
        let height = (image.height() * 3 / 4).max(1);
        image = image.resize_exact(width, height, image::imageops::FilterType::Triangle);
    }
    Err(NoteImageError::OutputTooLarge)
}

pub(super) fn prepare_note_image(
    bytes: &[u8],
    cancelled: impl Fn() -> bool,
) -> Result<PreparedNoteImage, NoteImageError> {
    check_cancelled(&cancelled)?;
    let (mut decoded, format, orientation) = decode(bytes)?;
    check_cancelled(&cancelled)?;
    decoded.apply_orientation(orientation);
    let decoded = DynamicImage::ImageRgba8(decoded.into_rgba8());
    let thumbnail_source = decoded.thumbnail(decoded.width().min(256), decoded.height().min(256));
    let image = if bytes.len() <= MAX_IMAGE_BYTES {
        EncodedNoteImage {
            bytes: bytes.to_vec(),
            format,
            width: decoded.width(),
            height: decoded.height(),
        }
    } else {
        fit_image(decoded, MAX_IMAGE_BYTES, &cancelled)?
    };
    let thumbnail = fit_image(thumbnail_source, MAX_THUMBNAIL_BYTES, &cancelled)?;
    check_cancelled(&cancelled)?;
    Ok(PreparedNoteImage {
        image,
        thumbnail,
        compressed: bytes.len() > MAX_IMAGE_BYTES,
    })
}

#[cfg(test)]
#[path = "note_image_tests.rs"]
mod tests;
