use std::io::{self, Cursor, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use super::input;
use super::tests::Fixture;
use crate::error::AppError;

fn compressed(fixture: &Fixture, name: &str, payload: &[u8]) -> PathBuf {
    let path = fixture.0.join(name);
    std::fs::write(&path, zstd::stream::encode_all(payload, 1).unwrap()).unwrap();
    path
}

#[test]
fn compression_detection_requires_the_native_double_suffix() {
    assert!(input::is_compressed(Path::new("rollout-native.jsonl.zst")));
    assert!(!input::is_compressed(Path::new("unrelated.zst")));
    assert!(!input::is_compressed(Path::new("rollout-native.jsonl")));
}

#[test]
fn plain_input_preserves_requested_prefix() {
    let fixture = Fixture::new();
    let path = fixture.0.join("plain.jsonl");
    std::fs::write(&path, b"first\nsecond\n").unwrap();
    let cancel = AtomicBool::new(false);
    let mut reader = input::open(&path, Some(6), &cancel).unwrap();
    let mut bytes = Vec::new();
    reader.read_to_end(&mut bytes).unwrap();
    assert_eq!(bytes, b"first\n");
}

#[test]
fn compressed_input_decodes_incrementally_without_writing_any_files() {
    let fixture = Fixture::new();
    let payload = "完整会话内容\n".repeat(10_000);
    let path = compressed(&fixture, "native.jsonl.zst", payload.as_bytes());
    let original = std::fs::read(&path).unwrap();
    let cancel = AtomicBool::new(false);
    let mut reader = input::open(&path, None, &cancel).unwrap();
    let mut bytes = Vec::new();
    let mut part = [0; 17];
    loop {
        let count = reader.read(&mut part).unwrap();
        if count == 0 {
            break;
        }
        bytes.extend_from_slice(&part[..count]);
    }
    assert_eq!(bytes, payload.as_bytes());
    assert_eq!(std::fs::read(&path).unwrap(), original);
    assert_eq!(std::fs::read_dir(&fixture.0).unwrap().count(), 1);
}

#[test]
fn concatenated_frames_decode_as_one_source() {
    let fixture = Fixture::new();
    let path = compressed(&fixture, "multi.jsonl.zst", b"first frame\n");
    let second = zstd::stream::encode_all(&b"second frame\n"[..], 1).unwrap();
    std::fs::OpenOptions::new()
        .append(true)
        .open(&path)
        .unwrap()
        .write_all(&second)
        .unwrap();
    let cancel = AtomicBool::new(false);
    let mut bytes = Vec::new();
    input::open(&path, None, &cancel)
        .unwrap()
        .read_to_end(&mut bytes)
        .unwrap();
    assert_eq!(bytes, b"first frame\nsecond frame\n");
}

#[test]
fn corrupt_magic_returns_format_error_without_exposing_codec_diagnostics() {
    let fixture = Fixture::new();
    let path = fixture.0.join("broken.jsonl.zst");
    std::fs::write(&path, b"untrusted non-zstandard data").unwrap();
    let cancel = AtomicBool::new(false);
    let mut bytes = Vec::new();
    let error = input::open(&path, None, &cancel)
        .unwrap()
        .read_to_end(&mut bytes)
        .unwrap_err();
    assert_eq!(AppError::from_io(&error).code, "agent_sessions:format");
}

#[test]
fn truncated_frame_returns_format_error() {
    let fixture = Fixture::new();
    let path = compressed(&fixture, "truncated.jsonl.zst", b"complete content\n");
    let mut bytes = std::fs::read(&path).unwrap();
    bytes.truncate(bytes.len() - 2);
    std::fs::write(&path, bytes).unwrap();
    let cancel = AtomicBool::new(false);
    let error = input::open(&path, None, &cancel)
        .unwrap()
        .read_to_end(&mut Vec::new())
        .unwrap_err();
    assert_eq!(AppError::from_io(&error).code, "agent_sessions:format");
}

#[test]
fn checksum_failure_at_end_of_frame_keeps_format_error() {
    let fixture = Fixture::new();
    let mut encoder = zstd::stream::write::Encoder::new(Vec::new(), 1).unwrap();
    encoder.include_checksum(true).unwrap();
    encoder
        .write_all(b"complete transcript before checksum\n")
        .unwrap();
    let mut bytes = encoder.finish().unwrap();
    *bytes.last_mut().unwrap() ^= 1;
    let path = fixture.0.join("checksum.jsonl.zst");
    std::fs::write(&path, bytes).unwrap();
    let cancel = AtomicBool::new(false);
    let error = input::open(&path, None, &cancel)
        .unwrap()
        .read_to_end(&mut Vec::new())
        .unwrap_err();
    assert_eq!(AppError::from_io(&error).code, "agent_sessions:format");
}

#[test]
fn missing_source_keeps_native_io_error_instead_of_format_error() {
    let fixture = Fixture::new();
    let error = input::open(
        &fixture.0.join("missing.jsonl.zst"),
        None,
        &AtomicBool::new(false),
    )
    .err()
    .unwrap();
    assert_eq!(error.code, "io:not_found");
}

#[test]
fn cancelling_before_open_does_not_attempt_to_read_source() {
    let fixture = Fixture::new();
    let error = input::open(
        &fixture.0.join("missing.jsonl.zst"),
        None,
        &AtomicBool::new(true),
    )
    .err()
    .unwrap();
    assert_eq!(error.code, "agent_sessions:cancelled");
}

#[test]
fn cancelling_between_decoded_reads_preserves_application_error() {
    let fixture = Fixture::new();
    let path = compressed(&fixture, "cancel.jsonl.zst", b"a complete transcript");
    let cancel = AtomicBool::new(false);
    let mut reader = input::open(&path, None, &cancel).unwrap();
    reader.read_exact(&mut [0; 1]).unwrap();
    cancel.store(true, Ordering::Release);
    let error = reader.read(&mut [0; 1]).unwrap_err();
    assert_eq!(AppError::from_io(&error).code, "agent_sessions:cancelled");
}

struct FailingSource;

impl Read for FailingSource {
    fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
        Err(io::Error::from(io::ErrorKind::PermissionDenied))
    }
}

#[test]
fn source_failure_through_decoder_preserves_io_classification() {
    let cancel = AtomicBool::new(false);
    let mut reader = input::test_decoder(FailingSource, &cancel, 1024, 27, Instant::now()).unwrap();
    let error = reader.read(&mut [0; 1]).unwrap_err();
    assert_eq!(AppError::from_io(&error).code, "io:permission_denied");
}

struct CancellingSource<'a> {
    bytes: Cursor<Vec<u8>>,
    cancel: &'a AtomicBool,
}

impl Read for CancellingSource<'_> {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        let count = self.bytes.read(buffer)?;
        self.cancel.store(true, Ordering::Release);
        Ok(count)
    }
}

#[test]
fn cancellation_inside_compressed_source_is_not_reclassified_as_corruption() {
    let cancel = AtomicBool::new(false);
    let source = CancellingSource {
        bytes: Cursor::new(zstd::stream::encode_all(&b"transcript"[..], 1).unwrap()),
        cancel: &cancel,
    };
    let mut reader = input::test_decoder(source, &cancel, 1024, 27, Instant::now()).unwrap();
    let error = reader.read(&mut [0; 1]).unwrap_err();
    assert_eq!(AppError::from_io(&error).code, "agent_sessions:cancelled");
}

#[test]
fn expired_deadline_returns_limit_without_waiting() {
    let cancel = AtomicBool::new(false);
    let encoded = zstd::stream::encode_all(&b"transcript"[..], 1).unwrap();
    let mut reader = input::test_decoder(
        Cursor::new(encoded),
        &cancel,
        1024,
        27,
        Instant::now() - Duration::from_secs(46),
    )
    .unwrap();
    let error = reader.read(&mut [0; 1]).unwrap_err();
    assert_eq!(AppError::from_io(&error).code, "agent_sessions:limit");
}

#[test]
fn exact_decoded_budget_allows_end_of_stream() {
    let payload = vec![b'x'; 4096];
    let encoded = zstd::stream::encode_all(payload.as_slice(), 1).unwrap();
    let cancel = AtomicBool::new(false);
    let mut reader =
        input::test_decoder(Cursor::new(encoded), &cancel, 4096, 27, Instant::now()).unwrap();
    let mut bytes = Vec::new();
    reader.read_to_end(&mut bytes).unwrap();
    assert_eq!(bytes, payload);
}

#[test]
fn decoded_budget_blocks_additional_bytes_from_reaching_consumer() {
    let encoded = zstd::stream::encode_all(vec![b'x'; 4096].as_slice(), 1).unwrap();
    let cancel = AtomicBool::new(false);
    let mut reader =
        input::test_decoder(Cursor::new(encoded), &cancel, 1024, 27, Instant::now()).unwrap();
    let mut bytes = Vec::new();
    let error = reader.read_to_end(&mut bytes).unwrap_err();
    assert_eq!(
        (AppError::from_io(&error).code.as_str(), bytes.len()),
        ("agent_sessions:limit", 1024)
    );
}

#[test]
fn decoded_budget_is_shared_by_concatenated_frames() {
    let mut encoded = zstd::stream::encode_all(vec![b'x'; 512].as_slice(), 1).unwrap();
    encoded.extend(zstd::stream::encode_all(vec![b'y'; 512].as_slice(), 1).unwrap());
    let cancel = AtomicBool::new(false);
    let mut reader =
        input::test_decoder(Cursor::new(encoded), &cancel, 600, 27, Instant::now()).unwrap();
    let mut bytes = Vec::new();
    let error = reader.read_to_end(&mut bytes).unwrap_err();
    assert_eq!(
        (AppError::from_io(&error).code.as_str(), bytes.len()),
        ("agent_sessions:limit", 600)
    );
}

#[test]
fn decoder_rejects_frame_exceeding_configured_window() {
    let encoded = zstd::stream::encode_all(vec![b'x'; 10_000].as_slice(), 1).unwrap();
    let cancel = AtomicBool::new(false);
    let mut reader =
        input::test_decoder(Cursor::new(encoded), &cancel, 20_000, 10, Instant::now()).unwrap();
    let error = reader.read_to_end(&mut Vec::new()).unwrap_err();
    assert_eq!(AppError::from_io(&error).code, "agent_sessions:format");
}

#[test]
fn oversized_compressed_source_is_rejected_before_decoding() {
    let fixture = Fixture::new();
    let path = compressed(&fixture, "too-large.jsonl.zst", b"transcript");
    std::fs::OpenOptions::new()
        .write(true)
        .open(&path)
        .unwrap()
        .set_len(512 * 1024 * 1024 + 1)
        .unwrap();
    let error = input::open(&path, None, &AtomicBool::new(false))
        .err()
        .unwrap();
    assert_eq!(error.code, "agent_sessions:limit");
}

#[test]
fn requested_prefix_longer_than_source_returns_changed() {
    let fixture = Fixture::new();
    let path = compressed(&fixture, "prefix.jsonl.zst", b"transcript");
    let length = std::fs::metadata(&path).unwrap().len() + 1;
    let error = input::open(&path, Some(length), &AtomicBool::new(false))
        .err()
        .unwrap();
    assert_eq!(error.code, "agent_sessions:changed");
}
