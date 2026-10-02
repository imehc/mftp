use std::future::Future;

use crate::error::AppResult;

/// Narrow credential port implemented by `adapters/ai.rs`. The AI service and
/// its callers never touch the AppHandle or the platform keychain directly;
/// only this crate's assembly layer wires the adapter in.
pub trait AiCredentials: Send + Sync {
    fn save(
        &self,
        reference: String,
        api_key: String,
    ) -> impl Future<Output = AppResult<()>> + Send;
    fn read(&self, reference: String) -> impl Future<Output = AppResult<Option<String>>> + Send;
    fn clear(&self, reference: String) -> impl Future<Output = AppResult<()>> + Send;
}
