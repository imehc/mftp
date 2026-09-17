use super::is_completed_archive;

#[test]
fn only_completed_archives_use_ephemeral_preview() {
    assert!(is_completed_archive("completed", "archive"));
    assert!(!is_completed_archive("active", "archive"));
    assert!(!is_completed_archive("completed", "direct"));
}
