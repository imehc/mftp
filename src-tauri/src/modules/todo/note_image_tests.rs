use super::*;
use image::ImageEncoder;
use std::cell::Cell;
use std::time::Instant;

fn png(image: &DynamicImage) -> Vec<u8> {
    let mut output = Cursor::new(Vec::new());
    image.write_to(&mut output, ImageFormat::Png).unwrap();
    output.into_inner()
}

fn solid(width: u32, height: u32) -> DynamicImage {
    DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
        width,
        height,
        image::Rgba([30, 80, 140, 255]),
    ))
}

fn noise(width: u32, height: u32, transparent: bool) -> DynamicImage {
    let mut state = 41_u32;
    DynamicImage::ImageRgba8(image::RgbaImage::from_fn(width, height, |_, _| {
        let mut pixel = [0; 4];
        for value in &mut pixel {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            *value = state as u8;
        }
        if !transparent {
            pixel[3] = 255;
        }
        image::Rgba(pixel)
    }))
}

fn assert_budget(result: &PreparedNoteImage) {
    assert!(result.image.bytes.len() <= MAX_IMAGE_BYTES);
    assert!(result.thumbnail.bytes.len() <= MAX_THUMBNAIL_BYTES);
    assert!(result.thumbnail.width <= 256);
    assert!(result.thumbnail.height <= 256);
    let image = image::load_from_memory(&result.image.bytes).unwrap();
    assert_eq!(image.width(), result.image.width);
    assert_eq!(image.height(), result.image.height);
    let thumbnail = image::load_from_memory(&result.thumbnail.bytes).unwrap();
    assert_eq!(thumbnail.width(), result.thumbnail.width);
    assert_eq!(thumbnail.height(), result.thumbnail.height);
}

#[test]
fn keeps_valid_images_at_or_below_exact_decimal_threshold() {
    for length in [499_999, 500_000] {
        let mut input = png(&solid(32, 16));
        input.resize(length, 0);
        let output = prepare_note_image(&input, || false).unwrap();
        assert_eq!(output.image.bytes, input);
        assert_eq!(output.image.format, ImageFormat::Png);
        assert!(!output.compressed);
        assert_budget(&output);
    }
}

#[test]
fn compresses_valid_image_one_byte_over_threshold() {
    let mut input = png(&solid(32, 16));
    input.resize(500_001, 0);
    let output = prepare_note_image(&input, || false).unwrap();
    assert!(output.compressed);
    assert!(output.image.bytes.len() < input.len());
    assert_eq!((output.image.width, output.image.height), (32, 16));
    assert_budget(&output);
}

#[test]
fn reduces_large_opaque_image_without_modifying_input() {
    let input = png(&noise(1_280, 960, false));
    let original = input.clone();
    assert!(input.len() > MAX_IMAGE_BYTES);
    let start = Instant::now();
    let output = prepare_note_image(&input, || false).unwrap();
    println!(
        "opaque: {} -> {} bytes, {}x{}, {:?}",
        input.len(),
        output.image.bytes.len(),
        output.image.width,
        output.image.height,
        start.elapsed()
    );
    assert_eq!(input, original);
    assert!(output.compressed);
    assert_eq!(output.image.format, ImageFormat::Jpeg);
    assert_budget(&output);
}

#[test]
fn preserves_transparency_when_multiple_resize_steps_are_needed() {
    let input = png(&noise(1_024, 768, true));
    let start = Instant::now();
    let output = prepare_note_image(&input, || false).unwrap();
    println!(
        "transparent: {} -> {} bytes, {}x{}, {:?}",
        input.len(),
        output.image.bytes.len(),
        output.image.width,
        output.image.height,
        start.elapsed()
    );
    assert_eq!(output.image.format, ImageFormat::WebP);
    assert!(output.image.width < 768);
    let decoded = image::load_from_memory(&output.image.bytes)
        .unwrap()
        .into_rgba8();
    assert!(decoded.pixels().any(|pixel| pixel.0[3] < 255));
    assert_budget(&output);
}

#[test]
fn rejects_input_and_pixel_bombs_even_if_file_is_small() {
    assert!(matches!(
        prepare_note_image(&vec![0; MAX_INPUT_BYTES + 1], || false),
        Err(NoteImageError::InputTooLarge)
    ));
    let input = png(&solid(4_000, 3_001));
    assert!(input.len() < MAX_IMAGE_BYTES);
    assert!(matches!(
        prepare_note_image(&input, || false),
        Err(NoteImageError::PixelLimit)
    ));
    let input = png(&solid(MAX_EDGE + 1, 1));
    assert!(matches!(
        prepare_note_image(&input, || false),
        Err(NoteImageError::EdgeLimit)
    ));
}

#[test]
fn rejects_svg_gif_and_corrupt_input() {
    for input in [
        b"<svg xmlns='http://www.w3.org/2000/svg'/>".as_slice(),
        b"GIF89a".as_slice(),
        b"untrusted bytes".as_slice(),
        b"".as_slice(),
    ] {
        assert!(matches!(
            prepare_note_image(input, || false),
            Err(NoteImageError::UnsupportedFormat)
        ));
    }
    let mut input = png(&solid(16, 16));
    input.truncate(input.len() / 2);
    let error = prepare_note_image(&input, || false).unwrap_err();
    assert!(matches!(error, NoteImageError::Codec(_)));
    if let NoteImageError::Codec(source) = error {
        assert!(!source.to_string().is_empty());
    }
}

#[test]
fn honours_cancellation_before_and_after_codec_work() {
    assert!(matches!(
        prepare_note_image(&[], || true),
        Err(NoteImageError::Cancelled)
    ));
    let input = png(&noise(512, 512, false));
    for stop_at in [2, 3, 4, 5] {
        let calls = Cell::new(0);
        let result = prepare_note_image(&input, || {
            calls.set(calls.get() + 1);
            calls.get() >= stop_at
        });
        assert!(matches!(result, Err(NoteImageError::Cancelled)));
    }
}

#[test]
fn bounded_encoder_never_keeps_over_budget_bytes() {
    let mut buffer = CappedBuffer::new(3);
    buffer.write_all(&[1, 2]).unwrap();
    assert!(buffer.write_all(&[3, 4]).is_err());
    assert_eq!(buffer.bytes, vec![1, 2]);
    assert!(buffer.exceeded);
    assert!(encode(&solid(32, 32), ImageFormat::Jpeg, 90, 1)
        .unwrap()
        .is_none());
}

#[test]
fn rejects_animated_png_instead_of_silently_taking_first_frame() {
    let mut bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut bytes, 1, 1);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_animated(2, 0).unwrap();
        let mut writer = encoder.write_header().unwrap();
        writer.write_image_data(&[255, 0, 0, 255]).unwrap();
        writer.write_image_data(&[0, 0, 255, 255]).unwrap();
    }
    assert!(matches!(
        prepare_note_image(&bytes, || false),
        Err(NoteImageError::AnimatedImage)
    ));
}

#[test]
fn rejects_animated_webp_instead_of_silently_taking_first_frame() {
    fn chunk(target: &mut Vec<u8>, name: &[u8; 4], bytes: &[u8]) {
        target.extend_from_slice(name);
        target.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
        target.extend_from_slice(bytes);
        if bytes.len() % 2 == 1 {
            target.push(0);
        }
    }

    let still = encode(&solid(1, 1), ImageFormat::WebP, 100, MAX_IMAGE_BYTES)
        .unwrap()
        .unwrap();
    let mut payload = b"WEBP".to_vec();
    chunk(&mut payload, b"VP8X", &[2, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    chunk(&mut payload, b"ANIM", &[0, 0, 0, 0, 0, 0]);
    let mut frame = vec![0; 16];
    frame[12] = 100;
    frame.extend_from_slice(&still.bytes[12..]);
    chunk(&mut payload, b"ANMF", &frame);
    chunk(&mut payload, b"ANMF", &frame);
    let mut bytes = b"RIFF".to_vec();
    bytes.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    bytes.extend(payload);
    assert!(WebPDecoder::new(Cursor::new(&bytes))
        .unwrap()
        .has_animation());
    assert!(matches!(
        prepare_note_image(&bytes, || false),
        Err(NoteImageError::AnimatedImage)
    ));
}

#[test]
fn applies_jpeg_orientation_to_thumbnail_and_compressed_image() {
    let mut input = Vec::new();
    let exif = vec![
        73, 73, 42, 0, 8, 0, 0, 0, 1, 0, 18, 1, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0,
    ];
    let mut encoder = JpegEncoder::new_with_quality(&mut input, 90);
    encoder.set_exif_metadata(exif).unwrap();
    encoder.encode_image(&solid(30, 20)).unwrap();
    let prepared = prepare_note_image(&input, || false).unwrap();
    assert_eq!((prepared.image.width, prepared.image.height), (20, 30));
    assert_eq!(prepared.image.bytes, input);
    assert_eq!(
        (prepared.thumbnail.width, prepared.thumbnail.height),
        (20, 30)
    );
    input.resize(MAX_IMAGE_BYTES + 1, 0);
    let prepared = prepare_note_image(&input, || false).unwrap();
    assert_eq!((prepared.image.width, prepared.image.height), (20, 30));
    assert_budget(&prepared);
    let mut decoder = ImageReader::new(Cursor::new(&prepared.image.bytes))
        .with_guessed_format()
        .unwrap()
        .into_decoder()
        .unwrap();
    assert_eq!(decoder.orientation().unwrap(), Orientation::NoTransforms);
}
