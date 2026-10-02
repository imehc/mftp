use super::*;
use crate::modules::lan_transfer::LanSharedDir;

fn temp_root(name: &str) -> std::path::PathBuf {
    let root = std::env::temp_dir().join(format!("mftp-lan-path-{name}-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    root
}

fn share(path: &std::path::Path) -> Vec<LanSharedDir> {
    vec![LanSharedDir {
        id: "s1".into(),
        name: "test".into(),
        path: path.to_string_lossy().into(),
        created_at: 0,
    }]
}

#[test]
fn malformed_requests_report_stable_codes() {
    let root = temp_root("malformed");
    let shares = share(&root);
    assert_eq!(
        resolve_request_path("GET /api/browse HTTP/1.1", &shares)
            .unwrap_err()
            .code,
        "lan:request_invalid"
    );
    assert_eq!(
        resolve_request_path("GET /api/browse?path=a HTTP/1.1", &shares)
            .unwrap_err()
            .code,
        "lan:share_unknown"
    );
    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
fn traversal_and_unknown_share_are_rejected_with_codes() {
    let root = temp_root("traversal");
    let shares = share(&root);
    let escaped =
        resolve_request_path("GET /api/browse?share=s1&path=../x HTTP/1.1", &shares).unwrap_err();
    assert_eq!(escaped.code, "lan:shared_path_invalid");
    assert_eq!(escaped.args.get("path").map(String::as_str), Some("../x"));
    assert_eq!(
        resolve_request_path("GET /api/browse?share=s1&path=/abs HTTP/1.1", &shares)
            .unwrap_err()
            .code,
        "lan:shared_path_invalid"
    );
    assert_eq!(
        resolve_request_path("GET /api/browse?share=nope&path=a HTTP/1.1", &shares)
            .unwrap_err()
            .code,
        "lan:share_unknown"
    );
    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
fn unavailable_share_base_is_typed() {
    let missing = std::env::temp_dir().join(format!("mftp-lan-path-gone-{}", uuid::Uuid::new_v4()));
    let shares = share(&missing);
    let error =
        resolve_request_path("GET /api/browse?share=s1&path=a HTTP/1.1", &shares).unwrap_err();
    assert_eq!(error.code, "lan:shared_dir_unavailable");
    assert_eq!(error.args.get("share").map(String::as_str), Some("s1"));
}

#[test]
fn missing_target_no_longer_falls_back_to_share_root() {
    let root = temp_root("fallback");
    std::fs::write(root.join("exists.txt"), b"hi").unwrap();
    let shares = share(&root);
    let resolved =
        resolve_request_path("GET /api/browse?share=s1&path=exists.txt HTTP/1.1", &shares).unwrap();
    assert_eq!(
        resolved.file_name().unwrap().to_string_lossy(),
        "exists.txt"
    );
    let error = resolve_request_path(
        "GET /api/browse?share=s1&path=missing.txt HTTP/1.1",
        &shares,
    )
    .unwrap_err();
    // The OS "not found" classification surfaces instead of the share root.
    assert_eq!(error.kind, crate::error::AppErrorKind::External);
    assert_eq!(error.code, "io:not_found");
    std::fs::remove_dir_all(&root).unwrap();
}
