use crate::error::{AppError, AppResult};

#[cfg(desktop)]
const CREDENTIAL_SERVICE: &str = "com.imehc.mftp.ai";
#[cfg(desktop)]
const CREDENTIAL_ACCOUNT: &str = "default";

#[cfg(desktop)]
fn entry() -> AppResult<keyring::Entry> {
    keyring::Entry::new(CREDENTIAL_SERVICE, CREDENTIAL_ACCOUNT)
        .map_err(|error| credential_error("open", error))
}

#[cfg(desktop)]
fn credential_error(action: &str, error: keyring::Error) -> AppError {
    AppError(format!(
        "Failed to {action} the system credential store: {error}"
    ))
}

#[cfg(desktop)]
pub fn save_api_key(api_key: &str) -> AppResult<()> {
    let api_key = api_key.trim();
    if api_key.is_empty() || api_key.len() > 16_384 {
        return Err(AppError("API key is empty or too long".into()));
    }
    entry()?
        .set_password(api_key)
        .map_err(|error| credential_error("write", error))
}

#[cfg(not(desktop))]
pub fn save_api_key(_api_key: &str) -> AppResult<()> {
    Err(AppError(
        "Secure AI credential storage is not available on this platform yet".into(),
    ))
}

#[cfg(desktop)]
pub fn read_api_key() -> AppResult<Option<String>> {
    match entry()?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(credential_error("read", error)),
    }
}

#[cfg(not(desktop))]
pub fn read_api_key() -> AppResult<Option<String>> {
    Err(AppError(
        "Secure AI credential storage is not available on this platform yet".into(),
    ))
}

pub fn has_api_key() -> AppResult<bool> {
    Ok(read_api_key()?.is_some())
}

#[cfg(desktop)]
pub fn clear_api_key() -> AppResult<()> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(credential_error("delete from", error)),
    }
}

#[cfg(not(desktop))]
pub fn clear_api_key() -> AppResult<()> {
    Err(AppError(
        "Secure AI credential storage is not available on this platform yet".into(),
    ))
}

#[cfg(desktop)]
pub fn clear_api_key_for_reset() -> AppResult<()> {
    clear_api_key()
}

#[cfg(not(desktop))]
pub fn clear_api_key_for_reset() -> AppResult<()> {
    Ok(())
}
