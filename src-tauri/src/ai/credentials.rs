use tauri::AppHandle;

use crate::error::{AppError, AppResult};

#[cfg(not(target_os = "android"))]
const CREDENTIAL_SERVICE: &str = "com.imehc.mftp.ai";
const CREDENTIAL_ACCOUNT: &str = "default";
const API_KEY_LIMIT: usize = 16_384;

fn validate_api_key(api_key: &str) -> AppResult<&str> {
    let api_key = api_key.trim();
    if api_key.is_empty() || api_key.len() > API_KEY_LIMIT {
        return Err(AppError("API key is empty or too long".into()));
    }
    Ok(api_key)
}

#[cfg(not(target_os = "android"))]
fn entry() -> AppResult<keyring::Entry> {
    keyring::Entry::new(CREDENTIAL_SERVICE, CREDENTIAL_ACCOUNT)
        .map_err(|error| credential_error("open", error))
}

#[cfg(not(target_os = "android"))]
fn credential_error(action: &str, error: keyring::Error) -> AppError {
    AppError(format!(
        "Failed to {action} the system credential store: {error}"
    ))
}

#[cfg(not(target_os = "android"))]
pub async fn save_api_key(_app: &AppHandle, api_key: &str) -> AppResult<()> {
    let api_key = validate_api_key(api_key)?.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        entry()?
            .set_password(&api_key)
            .map_err(|error| credential_error("write", error))
    })
    .await
    .map_err(|error| AppError(format!("Credential task failed: {error}")))?
}

#[cfg(target_os = "android")]
pub async fn save_api_key(app: &AppHandle, api_key: &str) -> AppResult<()> {
    use tauri_plugin_keystore::{KeystoreExt, StoreRequest};

    app.keystore()
        .store(StoreRequest {
            key: CREDENTIAL_ACCOUNT.into(),
            value: validate_api_key(api_key)?.into(),
            prompt: None,
        })
        .await
        .map_err(|error| {
            AppError(format!(
                "Failed to write the Android credential store: {error}"
            ))
        })
}

#[cfg(not(target_os = "android"))]
pub async fn read_api_key(_app: &AppHandle) -> AppResult<Option<String>> {
    tauri::async_runtime::spawn_blocking(move || match entry()?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(credential_error("read", error)),
    })
    .await
    .map_err(|error| AppError(format!("Credential task failed: {error}")))?
}

#[cfg(target_os = "android")]
pub async fn read_api_key(app: &AppHandle) -> AppResult<Option<String>> {
    use tauri_plugin_keystore::{KeystoreExt, RetrieveRequest};

    app.keystore()
        .retrieve(RetrieveRequest {
            key: CREDENTIAL_ACCOUNT.into(),
            prompt: None,
        })
        .await
        .map(|response| response.value)
        .map_err(|error| {
            AppError(format!(
                "Failed to read the Android credential store: {error}"
            ))
        })
}

pub async fn has_api_key(app: &AppHandle) -> AppResult<bool> {
    Ok(read_api_key(app).await?.is_some())
}

#[cfg(not(target_os = "android"))]
pub async fn clear_api_key(_app: &AppHandle) -> AppResult<()> {
    tauri::async_runtime::spawn_blocking(move || match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(credential_error("delete from", error)),
    })
    .await
    .map_err(|error| AppError(format!("Credential task failed: {error}")))?
}

#[cfg(target_os = "android")]
pub async fn clear_api_key(app: &AppHandle) -> AppResult<()> {
    use tauri_plugin_keystore::{KeystoreExt, RemoveRequest};

    app.keystore()
        .remove(RemoveRequest {
            key: CREDENTIAL_ACCOUNT.into(),
        })
        .await
        .map_err(|error| {
            AppError(format!(
                "Failed to delete from the Android credential store: {error}"
            ))
        })
}

pub async fn clear_api_key_for_reset(app: &AppHandle) -> AppResult<()> {
    clear_api_key(app).await
}
