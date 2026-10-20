//! Platform credential adapter implementing the AI module's narrow
//! `AiCredentials` port. This is the only place the keychain backend (macOS /
//! Windows keyring, Android keystore plugin) meets the AppHandle.

#[cfg(target_os = "android")]
use std::future::Future;
#[cfg(not(target_os = "android"))]
use std::sync::Arc;

use tauri::AppHandle;

use crate::error::{AppError, AppResult, CustomErrorCode};
use crate::modules::ai::AiCredentials;

#[cfg(target_os = "android")]
#[path = "ai_android.rs"]
mod android;
#[path = "ai_cache.rs"]
mod cache;
#[cfg(target_os = "android")]
#[path = "ai_lifecycle.rs"]
mod lifecycle;

const API_KEY_LIMIT: usize = 16_384;

#[derive(Clone)]
pub(crate) struct AiKeychain {
    #[cfg(not(target_os = "android"))]
    native: NativeKeychain,
    /// Installed apps reuse a read key briefly instead of hitting the keychain
    /// per request. Tests that share one store across instances bypass it.
    #[cfg(not(target_os = "android"))]
    cache: Option<Arc<cache::CachedCredentials<NativeKeychain>>>,
    #[cfg(target_os = "android")]
    credentials: std::sync::Arc<cache::CachedCredentials<android::AndroidKeychain>>,
}

/// Direct OS keychain access (macOS / Windows / Linux secret service / iOS).
#[cfg(not(target_os = "android"))]
#[derive(Clone)]
struct NativeKeychain {
    service: String,
    builder: Arc<keyring::CredentialBuilder>,
}

#[cfg(not(target_os = "android"))]
impl NativeKeychain {
    fn entry(&self, reference: &str) -> AppResult<keyring::Entry> {
        // Instance-local builders let tests use memory without changing the
        // process-global keyring backend or touching the OS credential store.
        self.builder
            .build(None, &self.service, reference)
            .map(keyring::Entry::new_with_credential)
            .map_err(|error| credential_error("open", error))
    }
}

impl AiKeychain {
    #[cfg(not(target_os = "android"))]
    pub(crate) fn install<R: tauri::Runtime>(app: &AppHandle<R>) -> Self {
        let mut keychain = Self::with_builder(
            &app.config().identifier,
            Arc::from(keyring::default::default_credential_builder()),
        );
        keychain.cache = Some(Arc::new(cache::CachedCredentials::new(
            keychain.native.clone(),
        )));
        keychain
    }

    #[cfg(target_os = "android")]
    pub(crate) fn install(app: &AppHandle) -> Self {
        let credentials = std::sync::Arc::new(cache::CachedCredentials::new(
            android::AndroidKeychain(app.clone()),
        ));
        lifecycle::register(&credentials);
        Self { credentials }
    }

    #[cfg(not(target_os = "android"))]
    fn with_builder(identifier: &str, builder: Arc<keyring::CredentialBuilder>) -> Self {
        // The final Tauri identifier also selects the application's data root.
        // Production retains com.imehc.mftp.ai, including the legacy default
        // account. Alternate builds never probe or fall back to that service.
        Self {
            native: NativeKeychain {
                service: format!("{identifier}.ai"),
                builder,
            },
            cache: None,
        }
    }

    #[cfg(all(test, desktop))]
    pub(crate) fn in_memory() -> Self {
        Self::with_builder(
            &format!("com.imehc.mftp.test.{}", uuid::Uuid::new_v4()),
            Arc::new(memory::MemoryCredentialBuilder::default()),
        )
    }

    #[cfg(all(test, desktop))]
    pub(crate) fn isolated_native_test() -> Self {
        Self::with_builder(
            &format!("com.imehc.mftp.native-test.{}", uuid::Uuid::new_v4()),
            Arc::from(keyring::default::default_credential_builder()),
        )
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

#[cfg(not(target_os = "android"))]
impl AiCredentials for NativeKeychain {
    async fn save(&self, reference: String, api_key: String) -> AppResult<()> {
        let native = self.clone();
        join_blocking(
            tauri::async_runtime::spawn_blocking(move || {
                native
                    .entry(&reference)?
                    .set_password(&api_key)
                    .map_err(|error| credential_error("write", error))
            })
            .await,
        )
    }

    async fn read(&self, reference: String) -> AppResult<Option<String>> {
        let native = self.clone();
        join_blocking(
            tauri::async_runtime::spawn_blocking(move || {
                match native.entry(&reference)?.get_password() {
                    Ok(value) => Ok(Some(value)),
                    Err(keyring::Error::NoEntry) => Ok(None),
                    Err(error) => Err(credential_error("read", error)),
                }
            })
            .await,
        )
    }

    async fn clear(&self, reference: String) -> AppResult<()> {
        let native = self.clone();
        join_blocking(
            tauri::async_runtime::spawn_blocking(move || {
                match native.entry(&reference)?.delete_credential() {
                    Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                    Err(error) => Err(credential_error("delete from", error)),
                }
            })
            .await,
        )
    }
}

impl AiCredentials for AiKeychain {
    #[cfg(not(target_os = "android"))]
    async fn save(&self, reference: String, api_key: String) -> AppResult<()> {
        let api_key = validate_api_key(api_key)?;
        let reference = validate_reference(reference)?;
        match &self.cache {
            Some(cache) => cache.save(reference, api_key).await,
            None => self.native.save(reference, api_key).await,
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
    async fn read(&self, reference: String) -> AppResult<Option<String>> {
        let reference = validate_reference(reference)?;
        match &self.cache {
            Some(cache) => cache.read(reference).await,
            None => self.native.read(reference).await,
        }
    }

    #[cfg(target_os = "android")]
    fn read(&self, reference: String) -> impl Future<Output = AppResult<Option<String>>> + Send {
        async move { self.credentials.read(validate_reference(reference)?).await }
    }

    #[cfg(not(target_os = "android"))]
    async fn clear(&self, reference: String) -> AppResult<()> {
        let reference = validate_reference(reference)?;
        match &self.cache {
            Some(cache) => cache.clear(reference).await,
            None => self.native.clear(reference).await,
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

#[cfg(all(test, not(target_os = "android")))]
#[path = "ai_memory.rs"]
mod memory;

#[cfg(all(test, desktop))]
#[path = "ai_isolation_tests.rs"]
mod isolation_tests;
