use std::collections::HashSet;
use std::fs;
use std::path::Path;

use super::{fallback_for_source, load_public_trackers, parse_tracker_urls, SourceTrackerInfo};

#[test]
fn tracker_urls_are_filtered_and_deduplicated() {
    let trackers = parse_tracker_urls([
        " udp://tracker.example/announce#fragment",
        "udp://tracker.example/announce",
        "file:///tmp/tracker",
        "not a url",
    ]);
    assert_eq!(trackers.len(), 1);
    assert_eq!(
        trackers.iter().next().unwrap().as_str(),
        "udp://tracker.example/announce"
    );
}

#[test]
fn private_or_tracked_sources_do_not_receive_public_fallbacks() {
    let public = parse_tracker_urls(["udp://public.example/announce"]);
    let private = SourceTrackerInfo {
        trackers: HashSet::new(),
        is_private: true,
    };
    let tracked = SourceTrackerInfo {
        trackers: parse_tracker_urls(["udp://source.example/announce"]),
        is_private: false,
    };
    assert!(fallback_for_source(Some(&private), &public).is_none());
    assert!(fallback_for_source(Some(&tracked), &public).is_none());

    let bare = SourceTrackerInfo {
        trackers: HashSet::new(),
        is_private: false,
    };
    assert_eq!(
        fallback_for_source(Some(&bare), &public),
        Some(vec!["udp://public.example/announce".to_string()])
    );
}

#[test]
fn public_tracker_config_is_local_and_replaces_defaults() {
    let root = tempfile_dir("tracker-config");
    let configured = root.join("trackers.json");
    fs::write(
        configured,
        r#"{"trackers":["https://configured.example/announce","https://configured.example/announce"]}"#,
    )
    .unwrap();

    let trackers = load_public_trackers(&root);
    assert_eq!(trackers.len(), 1);
    assert!(trackers
        .iter()
        .any(|tracker| tracker.as_str() == "https://configured.example/announce"));
    let _ = fs::remove_dir_all(root);
}

fn tempfile_dir(label: &str) -> std::path::PathBuf {
    let path = std::env::temp_dir().join(format!("mftp-{label}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&path);
    fs::create_dir_all(Path::new(&path)).unwrap();
    path
}
