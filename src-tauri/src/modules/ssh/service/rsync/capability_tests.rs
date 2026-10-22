use super::*;

#[test]
fn parses_upstream_rsync_versions() {
    let newer = parse_version_output(
        "rsync  version 3.5.1  protocol version 33\nCopyright (C) 1996-2026 by Andrew Tridgell",
    )
    .expect("3.5.1");
    assert_eq!(newer.version, "3.5.1");
    assert_eq!(newer.protocol, Some(33));
    assert!(is_supported(&newer));

    let minimum = parse_version_output("rsync  version 3.1.0  protocol version 31").expect("3.1.0");
    assert!(is_supported(&minimum));
}

#[test]
fn rejects_old_and_unrelated_version_output() {
    let old = parse_version_output("rsync  version 3.0.9  protocol version 30").expect("3.0.9");
    assert!(!is_supported(&old));

    let openrsync =
        parse_version_output("openrsync: protocol version 29\nrsync version 2.6.9 compatible");
    assert!(openrsync.is_none());

    let compat = parse_version_output("rsync version 2.6.9 compatible").expect("compat");
    assert!(!is_supported(&compat));

    assert!(parse_version_output("totally unrelated output").is_none());
    assert!(parse_version_output("").is_none());
}

#[test]
fn rejects_versions_without_numeric_components() {
    assert!(parse_major_minor("3").is_none());
    assert!(parse_major_minor("3.x.1").is_none());
    assert!(parse_major_minor("3.5.1.2").is_none());
    assert_eq!(parse_major_minor("3.5"), Some((3, 5)));
}

#[test]
fn protocol_must_reach_the_minimum_when_reported() {
    let info = VersionInfo {
        version: "3.5.1".into(),
        protocol: Some(29),
        major: 3,
        minor: 5,
    };
    assert!(!is_supported(&info));
    let info = VersionInfo {
        protocol: None,
        ..info
    };
    assert!(is_supported(&info));
}
