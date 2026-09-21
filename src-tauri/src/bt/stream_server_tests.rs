use super::{parse_range, resolve_range, split_route};

#[test]
fn parses_ranges_and_routes() {
    assert_eq!(parse_range("bytes=10-20"), Some((10, Some(20))));
    assert_eq!(parse_range("bytes=10-"), Some((10, None)));
    assert_eq!(parse_range("bytes=-20"), Some((u64::MAX, Some(20))));
    assert_eq!(
        split_route(&format!("{}/3", "a".repeat(40))),
        Some(("a".repeat(40), 3))
    );
}

#[test]
fn resolves_ranges_without_crossing_file_end() {
    assert_eq!(resolve_range(100, None), Some((0, 99, 200)));
    assert_eq!(
        resolve_range(100, Some((90, Some(200)))),
        Some((90, 99, 206))
    );
    assert_eq!(resolve_range(100, Some((100, None))), None);
    assert_eq!(
        resolve_range(100, Some((u64::MAX, Some(20)))),
        Some((80, 99, 206))
    );
    assert_eq!(resolve_range(100, Some((50, Some(20)))), None);
}
