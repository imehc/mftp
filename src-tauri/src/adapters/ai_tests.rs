use super::*;

#[cfg(not(target_os = "android"))]
#[path = "ai_native_tests.rs"]
mod native;

#[cfg(not(target_os = "android"))]
#[path = "ai_migration_native_tests.rs"]
mod native_migration;

#[test]
fn references_accept_only_owned_accounts() {
    assert!(validate_reference("default".into()).is_ok());
    assert!(validate_reference(format!("ai-{}", uuid::Uuid::new_v4())).is_ok());
    for invalid in ["", "secret-token", "https://api.example.com", "ai-invalid"] {
        let error = validate_reference(invalid.into()).unwrap_err();
        assert_eq!(error.message, "Invalid AI credential reference");
    }
}

#[test]
fn invalid_keys_never_appear_in_errors() {
    for value in [" ".to_string(), "secret".repeat(API_KEY_LIMIT)] {
        let error = validate_api_key(value).unwrap_err();
        assert!(!format!("{error:?}").contains("secret"));
    }
    assert_eq!(validate_api_key(" key ".into()).unwrap(), "key");
}

#[cfg(not(target_os = "android"))]
#[test]
fn credential_errors_redact_encoding_bytes_and_join_details() {
    let error = credential_error(
        "read",
        keyring::Error::BadEncoding(b"private-secret".to_vec()),
    );
    assert!(!format!("{error:?}").contains("private-secret"));
    let error = join_blocking::<()>(Err("private-secret")).unwrap_err();
    assert!(!format!("{error:?}").contains("private-secret"));
}
