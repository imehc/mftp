use super::{parse_request_range, RangeRequest};

fn resolve(value: Option<&str>, total: u64) -> Option<(u64, u64, bool)> {
    let header = value
        .map(|value| format!("Range: {value}\r\n"))
        .unwrap_or_default();
    parse_request_range(&format!("GET / HTTP/1.1\r\n{header}\r\n"))
        .resolve(total)
        .map(|range| (range.start, range.length, range.partial))
}

#[test]
fn resolves_bounded_open_suffix_and_empty_ranges() {
    assert_eq!(resolve(None, 100), Some((0, 100, false)));
    assert_eq!(resolve(None, 0), Some((0, 0, false)));
    for (value, expected) in [
        ("bytes=10-20", (10, 11, true)),
        ("bytes=90-200", (90, 10, true)),
        ("bytes=10-", (10, 90, true)),
        ("bytes=-20", (80, 20, true)),
        ("bytes=-200", (0, 100, true)),
        ("bytes=0-99", (0, 100, true)),
        ("BYTES=99-99", (99, 1, true)),
    ] {
        assert_eq!(resolve(Some(value), 100), Some(expected), "{value}");
        assert_eq!(resolve(Some(value), 0), None, "{value}");
    }
}

#[test]
fn rejects_invalid_unsatisfiable_and_multipart_ranges() {
    for value in [
        "bytes=-0",
        "bytes=100-",
        "bytes=50-20",
        "bytes=-",
        "bytes=",
        "bytes=0-1,3-4",
        "bytes=+1-2",
        "bytes=1-+2",
        "bytes=1 -2",
        "bytes=1--2",
        "bytes=1-2-3",
        "items=1-2",
        "bytes=18446744073709551616-",
        "garbage",
        "bytes=0-1\r\nrange: bytes=2-3",
    ] {
        assert_eq!(resolve(Some(value), 100), None, "{value}");
    }
}

#[test]
fn extreme_offsets_are_not_confused_with_suffixes_or_overflowed() {
    assert_eq!(resolve(Some("bytes=18446744073709551615-2"), 100), None);
    assert_eq!(
        resolve(Some("bytes=0-18446744073709551615"), u64::MAX),
        Some((0, u64::MAX, true))
    );
    assert_eq!(
        resolve(Some("bytes=18446744073709551614-"), u64::MAX),
        Some((u64::MAX - 1, 1, true))
    );
    assert_eq!(
        resolve(Some("bytes=-18446744073709551615"), u64::MAX),
        Some((0, u64::MAX, true))
    );
}

#[test]
fn only_header_fields_are_parsed() {
    assert_eq!(
        parse_request_range("GET / HTTP/1.1\r\n\r\nRange: bytes=0-1"),
        RangeRequest::Absent
    );
    let range = parse_request_range("GET / HTTP/1.1\r\nrAnGe: \tbytes=0-1 \t\r\n\r\n")
        .resolve(10)
        .unwrap();
    assert_eq!((range.start, range.end(), range.length), (0, 1, 2));
}
