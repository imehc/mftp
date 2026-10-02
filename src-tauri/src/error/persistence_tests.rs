use super::*;
use crate::error::CustomErrorCode;

#[test]
fn version_one_preserves_both_error_kinds_and_parameters() {
    for error in [
        AppError::custom(CustomErrorCode::BtArchiveAlreadyExists)
            .with_arg("path", "目录/archive.tar"),
        AppError::from(std::io::Error::from_raw_os_error(13)).with_arg("operation", "read"),
    ] {
        let payload = encode(&error).unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&payload).unwrap()["version"],
            1
        );
        assert_eq!(decode(Some(&payload), Some("old diagnostic")), Some(error));
    }
}

#[test]
fn old_invalid_and_unknown_payloads_fall_back_without_reclassifying_text() {
    let legacy = "historical permission denied";
    for payload in [
        None,
        Some("not JSON"),
        Some(r#"{"version":2,"error":{}}"#),
        Some(r#"{"version":1,"error":{"kind":"custom"}}"#),
    ] {
        let error = decode(payload, Some(legacy)).unwrap();
        assert_eq!(error.code, "legacy:raw");
        assert_eq!(error.message, legacy);
    }
    assert_eq!(decode(None, None), None);
    assert_eq!(decode(None, Some("  ")), None);
    let error = decode(Some("secret raw payload"), None).unwrap();
    assert_eq!(error.code, "storage:error_payload");
    assert!(!error.message.contains("secret"));
}
