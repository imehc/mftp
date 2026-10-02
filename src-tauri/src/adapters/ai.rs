//! Platform credential adapter implementing the AI module's narrow
//! `AiCredentials` port. This is the only place the keychain backend (macOS /
//! Windows keyring, Android keystore plugin) meets the AppHandle.

use std::future::Future;

use tauri::AppHandle;

use crate::error::{AppError, AppResult, CustomErrorCode};
use crate::modules::ai::AiCredentials;

#[cfg(target_os = "android")]
#[path = "ai_android.rs"]
mod android;
#[cfg(any(target_os = "android", test))]
#[path = "ai_cache.rs"]
mod cache;
#[cfg(target_os = "android")]
#[path = "ai_lifecycle.rs"]
mod lifecycle;

#[cfg(not(target_os = "android"))]
const CREDENTIAL_SERVICE: &str = "com.imehc.mftp.ai";
const API_KEY_LIMIT: usize = 16_384;

#[cfg_attr(all(test, desktop), derive(Default))]
pub(crate) struct AiKeychain {
    #[cfg(target_os = "android")]
    credentials: std::sync::Arc<cache::CachedCredentials<android::AndroidKeychain>>,
}

impl AiKeychain {
    pub(crate) fn install(app: &AppHandle) -> Self {
        #[cfg(not(target_os = "android"))]
        {
            let _ = app;
            Self {}
        }
        #[cfg(target_os = "android")]
        {
            let credentials = std::sync::Arc::new(cache::CachedCredentials::new(
                android::AndroidKeychain(app.clone()),
            ));
            lifecycle::register(&credentials);
            Self { credentials }
        }
    }

    #[cfg(target_os = "android")]
    pub(crate) fn on_run_event(&self, event: &tauri::RunEvent) {
        // Activity pause/resume is handled synchronously by the JNI bridge.
        match event {
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit => {
                self.credentials.set_foreground(false)
            }
            _ => {}
        }
    }
}

fn validate_api_key(api_key: String) -> AppResult<String> {
    let api_key = api_key.trim().to_string();
    if api_key.is_empty() || api_key.len() > API_KEY_LIMIT {
        return Err(AppError::custom(CustomErrorCode::AiApiKeyInvalid));
    }
    Ok(api_key)
}

#[cfg(not(target_os = "android"))]
fn entry(reference: &str) -> AppResult<keyring::Entry> {
    keyring::Entry::new(CREDENTIAL_SERVICE, reference)
        .map_err(|error| credential_error("open", error))
}

#[cfg(not(target_os = "android"))]
fn credential_error(action: &str, error: keyring::Error) -> AppError {
    AppError::external(
        "credential:store",
        format!(
            "Failed to {action} the system credential store ({})",
            match error {
                keyring::Error::NoEntry => "missing",
                keyring::Error::BadEncoding(_) => "invalid encoding",
                _ => "platform failure",
            }
        ),
    )
}

#[cfg(not(target_os = "android"))]
fn join_blocking<T: Send + 'static>(
    result: Result<AppResult<T>, impl std::fmt::Display>,
) -> AppResult<T> {
    match result {
        Ok(inner) => inner,
        Err(_) => Err(AppError::external(
            "credential:store",
            "Credential task failed",
        )),
    }
}

impl AiCredentials for AiKeychain {
    #[cfg(not(target_os = "android"))]
    fn save(
        &self,
        reference: String,
        api_key: String,
    ) -> impl Future<Output = AppResult<()>> + Send {
        let prepared = validate_api_key(api_key);
        async move {
            let api_key = prepared?;
            let reference = validate_reference(reference)?;
            join_blocking(
                tauri::async_runtime::spawn_blocking(move || {
                    entry(&reference)?
                        .set_password(&api_key)
                        .map_err(|error| credential_error("write", error))
                })
                .await,
            )
        }
    }

    #[cfg(target_os = "android")]
    fn save(
        &self,
        reference: String,
        api_key: String,
    ) -> impl Future<Output = AppResult<()>> + Send {
        async move {
            self.credentials
                .save(validate_reference(reference)?, validate_api_key(api_key)?)
                .await
        }
    }

    #[cfg(not(target_os = "android"))]
    fn read(&self, reference: String) -> impl Future<Output = AppResult<Option<String>>> + Send {
        async move {
            let reference = validate_reference(reference)?;
            join_blocking(
                tauri::async_runtime::spawn_blocking(move || {
                    match entry(&reference)?.get_password() {
                        Ok(value) => Ok(Some(value)),
                        Err(keyring::Error::NoEntry) => Ok(None),
                        Err(error) => Err(credential_error("read", error)),
                    }
                })
                .await,
            )
        }
    }

    #[cfg(target_os = "android")]
    fn read(&self, reference: String) -> impl Future<Output = AppResult<Option<String>>> + Send {
        async move { self.credentials.read(validate_reference(reference)?).await }
    }

    #[cfg(not(target_os = "android"))]
    fn clear(&self, reference: String) -> impl Future<Output = AppResult<()>> + Send {
        async move {
            let reference = validate_reference(reference)?;
            join_blocking(
                tauri::async_runtime::spawn_blocking(move || {
                    match entry(&reference)?.delete_credential() {
                        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                        Err(error) => Err(credential_error("delete from", error)),
                    }
                })
                .await,
            )
        }
    }

    #[cfg(target_os = "android")]
    fn clear(&self, reference: String) -> impl Future<Output = AppResult<()>> + Send {
        async move { self.credentials.clear(validate_reference(reference)?).await }
    }
}

// References are application-owned accounts, never user-supplied labels or URLs.
fn validate_reference(reference: String) -> AppResult<String> {
    if reference == "default"
        || reference
            .strip_prefix("ai-")
            .and_then(|id| uuid::Uuid::parse_str(id).ok())
            .is_some()
    {
        Ok(reference)
    } else {
        Err(AppError::external(
            "credential:store",
            "Invalid AI credential reference",
        ))
    }
}

#[cfg(test)]
#[path = "ai_tests.rs"]
mod tests;
