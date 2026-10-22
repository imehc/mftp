//! Auth method mapping shared by session connections and the host form's
//! connection test. No network or key-store access is involved beyond the
//! injected lookup.

use super::*;
use crate::modules::hosts::model::AuthType;

fn unused_lookup(_: &str) -> AppResult<String> {
    unreachable!("key store must not be read")
}

#[test]
fn empty_password_falls_back_to_local_credentials() {
    let method = auth_method(&AuthType::Password, Some(""), None, unused_lookup, None).unwrap();
    assert!(matches!(method, AuthMethod::Password(None)));
}

#[test]
fn password_auth_keeps_password_and_ignores_key_fields() {
    let method = auth_method(
        &AuthType::Password,
        Some("secret"),
        Some("ignored-key"),
        unused_lookup,
        Some("ignored-passphrase".into()),
    )
    .unwrap();
    match method {
        AuthMethod::Password(password) => assert_eq!(password.as_deref(), Some("secret")),
        AuthMethod::Key { .. } => panic!("expected password auth"),
    }
}

#[test]
fn key_auth_requires_a_selected_key() {
    let error = auth_method(
        &AuthType::Key,
        Some("ignored-password"),
        None,
        unused_lookup,
        None,
    )
    .err()
    .unwrap();
    assert_eq!(error.code, "ssh:key_not_selected");
}

#[test]
fn key_auth_resolves_the_selected_key_and_keeps_only_the_passphrase() {
    let method = auth_method(
        &AuthType::Key,
        Some("ignored-password"),
        Some("key-1"),
        |id| {
            assert_eq!(id, "key-1");
            Ok("PRIVATE-KEY".into())
        },
        Some("phrase".into()),
    )
    .unwrap();
    match method {
        AuthMethod::Key {
            private_key,
            passphrase,
        } => {
            assert_eq!(private_key, "PRIVATE-KEY");
            assert_eq!(passphrase.as_deref(), Some("phrase"));
        }
        AuthMethod::Password(_) => panic!("expected key auth"),
    }
}
