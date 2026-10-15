use super::*;

#[test]
fn comment_lines_accept_all_sse_line_endings_and_split_utf8() {
    for ending in ["\n", "\r", "\r\n"] {
        let bytes = format!("\u{feff}: 心跳{ending}").into_bytes();
        for split in 0..bytes.len() {
            let mut comments = SseComments::new();
            let first = comments.observe(&bytes[..split]);
            let second = comments.observe(&bytes[split..]);
            assert!(first || second);
            assert!(!(first && second));
        }
    }
}

#[test]
fn incomplete_invalid_and_non_comment_lines_are_not_heartbeats() {
    let mut comments = SseComments::new();
    assert!(!comments.observe(b": unfinished"));
    assert!(comments.observe(b"\n"));
    assert!(!comments.observe(b": invalid \xff\n"));
    assert!(!comments.observe(b"data: {\"text\":\":not a heartbeat\"}\n\n"));
    assert!(!comments.observe(b" : leading whitespace\n"));
    assert!(!comments.observe("\u{feff}: misplaced BOM\n".as_bytes()));
    assert!(comments.observe(b":\n"));
}

#[test]
fn oversized_lines_use_bounded_memory_and_recover_on_the_next_line() {
    let mut comments = SseComments::new();
    assert!(!comments.observe(b":"));
    assert!(!comments.observe(&vec![b'x'; LINE_LIMIT * 2]));
    assert_eq!(comments.line.len(), LINE_LIMIT);
    assert!(!comments.observe(b"\n"));
    assert!(comments.observe(b": next\r\n"));
}
