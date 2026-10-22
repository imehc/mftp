use super::*;
use crate::modules::ssh::RsyncChangeKind;
use std::time::Duration;

#[test]
fn itemize_parser_counts_changes_and_skips_metadata_only() {
    let output = b"\r  1,048,576  12%  1.23MB/s  0:00:01 (xfr#1, to-chk=4/6)\r\
>f+++++++++ alpha.txt\n\
>f.st...... nested/beta.txt\n\
cd+++++++++ nested/\n\
cL+++++++++ link -> alpha.txt\n\
.d...p..... ./\n\
.L...p..... link -> alpha.txt\n\
*deleting   extra-dir/child.txt\n\
*deleting   extra-dir/\n\
*deleting   extra.txt\n";
    let summary = parse_itemized(output, 500);
    assert_eq!(summary.added, 3);
    assert_eq!(summary.updated, 1);
    assert_eq!(summary.deleted, 3);
    assert!(!summary.truncated);
    assert!(summary.items.iter().any(|item| {
        item.kind == RsyncChangeKind::Added && item.path == "alpha.txt" && !item.is_dir
    }));
    assert!(summary.items.iter().any(|item| {
        item.kind == RsyncChangeKind::Added && item.path == "link" && !item.is_dir
    }));
    assert!(summary.items.iter().any(|item| {
        item.kind == RsyncChangeKind::Added && item.path == "nested" && item.is_dir
    }));
    assert!(summary.items.iter().any(|item| {
        item.kind == RsyncChangeKind::Deleted && item.path == "extra-dir" && item.is_dir
    }));
    assert!(summary
        .items
        .iter()
        .any(|item| item.kind == RsyncChangeKind::Deleted && item.path == "extra.txt"));
}

#[test]
fn itemize_parser_truncates_items_but_keeps_counts() {
    let output = b">f+++++++++ one\n>f+++++++++ two\n>f+++++++++ three\n";
    let summary = parse_itemized(output, 2);
    assert_eq!(summary.added, 3);
    assert_eq!(summary.items.len(), 2);
    assert!(summary.truncated);
}

#[test]
fn itemize_parser_ignores_progress_and_unrelated_lines() {
    let output = b"sending incremental file list\n\
\r  4,096  50%  0.00kB/s  0:00:00 (xfr#0, to-chk=1/2)\r\
>f+++++++++ done.txt\n";
    let summary = parse_itemized(output, 500);
    assert_eq!(summary.added, 1);
    assert_eq!(summary.updated, 0);
    assert_eq!(summary.deleted, 0);
    assert_eq!(summary.items.len(), 1);
}

#[test]
fn progress2_parser_uses_the_last_complete_segment() {
    let output = b"\r        1,048,576  12%    1.23MB/s    0:00:01 (xfr#1, to-chk=4/6)\
\r        2,097,152  24%    1.24MB/s    0:00:02 (xfr#2, to-chk=3/6)\
\r        3,145,7";
    assert_eq!(last_progress_bytes(output), 2_097_152);
}

#[test]
fn progress2_parser_returns_zero_without_progress() {
    assert_eq!(last_progress_bytes(b"sending incremental file list\n"), 0);
}

#[test]
fn preview_token_is_single_use() {
    let registry = PreviewRegistry::default();
    let token = registry.insert(record("session", RsyncDirection::Upload));
    assert!(registry.take(&token).is_some());
    assert!(registry.take(&token).is_none());
}

#[test]
fn expired_preview_is_discarded() {
    let registry = PreviewRegistry::default();
    let token = "expired-token".to_string();
    let mut expired = record("session", RsyncDirection::Upload);
    expired.created_at = std::time::Instant::now() - Duration::from_secs(601);
    registry.records.lock().insert(token.clone(), expired);
    assert!(registry.take(&token).is_none());
}

#[test]
fn preview_registry_is_bounded_and_session_scoped() {
    let registry = PreviewRegistry::default();
    let first = registry.insert(record("one", RsyncDirection::Upload));
    let other = registry.insert(record("two", RsyncDirection::Download));
    registry.forget_session("one");
    assert!(registry.take(&first).is_none());
    assert!(registry.take(&other).is_some());

    let mut tokens = Vec::new();
    for _ in 0..40 {
        tokens.push(registry.insert(record("three", RsyncDirection::Upload)));
    }
    assert!(registry.records.lock().len() <= PREVIEW_LIMIT);
    assert!(registry.take(tokens.last().expect("last token")).is_some());
}

fn record(session: &str, direction: RsyncDirection) -> PreviewRecord {
    PreviewRecord {
        session_id: session.to_string(),
        direction,
        local_dir: "/tmp/source".into(),
        remote_dir: "/remote/target".into(),
        delete_extraneous: false,
        created_at: std::time::Instant::now(),
    }
}
