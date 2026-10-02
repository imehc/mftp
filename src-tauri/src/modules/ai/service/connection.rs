use super::client::test_connection;
#[cfg(test)]
use super::url::validate_connection;
use crate::core::{
    activity::OperationContext,
    execution::{run_blocking, Executor},
    operations::{MaintenanceLease, Operations},
};
use crate::error::{AppError, AppResult, CustomErrorCode};
use crate::modules::ai::{AiConnectionConfig, AiCredentials, AiRepository};
use std::{future::Future, sync::Arc};
use tokio::sync::Mutex;

// No Debug/Serialize/Specta: the credential exists only in the request's memory.
pub(crate) struct AiRequestSnapshot {
    pub config: AiConnectionConfig,
    pub api_key: String,
}

pub(crate) struct AiConfigurationService<C: AiCredentials> {
    repository: AiRepository,
    credentials: Arc<C>,
    coordinator: Mutex<()>,
    executor: Executor,
    operations: Arc<Operations>,
}

impl<C: AiCredentials + 'static> AiConfigurationService<C> {
    pub(crate) fn new(
        repository: AiRepository,
        credentials: Arc<C>,
        executor: Executor,
        operations: Arc<Operations>,
    ) -> Arc<Self> {
        Arc::new(Self {
            repository,
            credentials,
            coordinator: Mutex::new(()),
            executor,
            operations,
        })
    }

    async fn db<T: Send + 'static>(
        &self,
        f: impl FnOnce(AiRepository) -> AppResult<T> + Send + 'static,
    ) -> AppResult<T> {
        let repository = self.repository.clone();
        run_blocking(move || f(repository)).await
    }

    async fn owned<T, F, Fut>(self: &Arc<Self>, action: Option<&'static str>, f: F) -> AppResult<T>
    where
        T: Send + 'static,
        F: FnOnce(Arc<Self>) -> Fut + Send + 'static,
        Fut: Future<Output = AppResult<T>> + Send + 'static,
    {
        let service = self.clone();
        // Dropping an IPC waiter only drops the join handle. The owned worker
        // retains admission and coordination across every actual credential/SQL operation.
        tauri::async_runtime::spawn(async move {
            let operation = async {
                let _lock = service.coordinator.lock().await;
                f(service.clone()).await
            };
            if let Some(action) = action {
                service
                    .executor
                    .asynchronous(OperationContext::new("ai", action, "local"), operation)
                    .await
            } else {
                let _lease = service.operations.begin()?;
                operation.await
            }
        })
        .await
        .map_err(AppError::from)?
    }

    async fn recover_locked(&self) -> AppResult<()> {
        let pending = self.db(|r| r.pending_credentials()).await?;
        let mut first_error = None;
        for reference in pending {
            let result = async {
                let checked = reference.clone();
                self.db(move |r| r.ensure_unreferenced(&checked)).await?;
                self.credentials.clear(reference.clone()).await?;
                self.db(move |r| r.forget_pending(&reference)).await
            }
            .await;
            if let Err(error) = result {
                if first_error.is_none() {
                    first_error = Some(error);
                }
            }
        }
        match first_error {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }

    async fn recover_best_effort(&self) {
        if let Err(error) = self.recover_locked().await {
            eprintln!("AI credential cleanup pending: {}", error.code);
        }
    }

    pub(crate) async fn recover(self: &Arc<Self>) -> AppResult<()> {
        self.owned(
            None,
            |service| async move { service.recover_locked().await },
        )
        .await
    }

    pub(crate) async fn cleanup_after_reset(
        self: &Arc<Self>,
        maintenance: Arc<MaintenanceLease>,
    ) -> AppResult<()> {
        let service = self.clone();
        // Maintenance has already drained admission. Keep its exclusive lease
        // alive through the owned cleanup worker even if the reset waiter closes.
        tauri::async_runtime::spawn(async move {
            let _maintenance = maintenance;
            let _lock = service.coordinator.lock().await;
            service.recover_locked().await
        })
        .await
        .map_err(AppError::from)?
    }

    pub(crate) async fn request_snapshot(self: &Arc<Self>) -> AppResult<AiRequestSnapshot> {
        self.owned(None, |service| async move {
            service.snapshot_locked(None).await
        })
        .await
    }
}

#[cfg(test)]
#[path = "connection_tests.rs"]
mod tests;

#[path = "management.rs"]
mod management;

#[path = "selection.rs"]
mod selection;

// Legacy callers no longer exist; historical tests still seed old credential states.
#[cfg(test)]
#[path = "legacy_fixture.rs"]
mod legacy_fixture;
#[cfg(test)]
pub(crate) use legacy_fixture::AiConnectionInput;
