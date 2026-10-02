//! The native plugin retains per-operation biometric protection. Reuse is
//! implemented by the Rust adapter without changing Android Keystore policy.

use tauri_plugin_keystore::{KeystoreExt, RemoveRequest, RetrieveRequest, StoreRequest};

use crate::{
    error::{AppError, AppResult},
    modules::ai::AiCredentials,
};

pub(super) struct AndroidKeychain(pub(super) tauri::AppHandle);

impl AiCredentials for AndroidKeychain {
    async fn save(&self, reference: String, value: String) -> AppResult<()> {
        self.0
            .keystore()
            .store(StoreRequest {
                key: reference,
                value,
                prompt: None,
            })
            .await
            .map_err(|_| failure("write"))
    }

    async fn read(&self, reference: String) -> AppResult<Option<String>> {
        self.0
            .keystore()
            .retrieve(RetrieveRequest {
                key: reference,
                prompt: None,
            })
            .await
            .map(|response| response.value)
            .map_err(|_| failure("read"))
    }

    async fn clear(&self, reference: String) -> AppResult<()> {
        self.0
            .keystore()
            .remove(RemoveRequest { key: reference })
            .await
            .map_err(|_| failure("delete from"))
    }
}

fn failure(action: &str) -> AppError {
    // Plugin diagnostics can contain request data. Never forward them to IPC.
    AppError::external(
        "credential:store",
        format!("Failed to {action} the Android credential store"),
    )
}
