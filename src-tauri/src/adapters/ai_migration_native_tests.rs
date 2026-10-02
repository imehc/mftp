//! Native migration acceptance using an isolated database and credential namespace.

use crate::{
    adapters::activity_log::StorageActivityLog,
    core::{execution::Executor, operations::Operations},
    error::{AppError, AppResult},
    modules::ai::{AiConfigurationService, AiConnectionInput, AiCredentials, AiRepository},
    storage::Storage,
};
use parking_lot::Mutex;
use std::{
    collections::HashSet,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

struct Isolated<C> {
    native: C,
    default: String,
    references: Mutex<HashSet<String>>,
    fail_cleanup: AtomicBool,
}

impl<C> Isolated<C> {
    fn reference(&self, reference: String) -> String {
        // The production migration still sees "default"; the OS only sees a
        // random account. Never read or modify the user's real legacy account.
        let reference = if reference == "default" {
            self.default.clone()
        } else {
            reference
        };
        self.references.lock().insert(reference.clone());
        reference
    }
}

impl<C: AiCredentials> AiCredentials for Isolated<C> {
    async fn save(&self, reference: String, value: String) -> AppResult<()> {
        self.native.save(self.reference(reference), value).await
    }
    async fn read(&self, reference: String) -> AppResult<Option<String>> {
        self.native.read(self.reference(reference)).await
    }
    async fn clear(&self, reference: String) -> AppResult<()> {
        if self.fail_cleanup.load(Ordering::SeqCst) {
            return Err(failure("injected_cleanup_failure"));
        }
        self.native.clear(self.reference(reference)).await
    }
}

fn failure(step: &'static str) -> AppError {
    AppError::external("credential:test", step)
}

fn require(condition: bool, step: &'static str) -> AppResult<()> {
    if condition {
        Ok(())
    } else {
        Err(failure(step))
    }
}

fn service<C: AiCredentials + 'static>(
    storage: Storage,
    credentials: Arc<C>,
) -> Arc<AiConfigurationService<C>> {
    let operations = Arc::new(Operations::default());
    let executor = Executor::new(
        Arc::new(StorageActivityLog(storage.clone())),
        operations.clone(),
    );
    AiConfigurationService::new(
        AiRepository::new(storage),
        credentials,
        executor,
        operations,
    )
}

fn journal_count(storage: &Storage) -> AppResult<i64> {
    Ok(rusqlite::Connection::open(storage.db_path())?.query_row(
        "SELECT COUNT(*) FROM ai_credential_journal",
        [],
        |row| row.get(0),
    )?)
}

pub(crate) async fn verify_migration<C: AiCredentials + 'static>(
    native: C,
    parent: PathBuf,
    mut progress: impl FnMut(&'static str),
) -> AppResult<()> {
    let root = parent.join(format!("native-ai-migration-{}", uuid::Uuid::new_v4()));
    let credentials = Arc::new(Isolated {
        native,
        default: format!("ai-{}", uuid::Uuid::new_v4()),
        references: Mutex::new(HashSet::new()),
        fail_cleanup: AtomicBool::new(false),
    });
    let result: AppResult<()> = async {
        let storage = Storage::new(root.clone())?;
        rusqlite::Connection::open(storage.db_path())?.execute_batch(
            "DROP TABLE ai_settings; DROP TABLE ai_providers;
            DROP TABLE ai_provider_keys; DROP TABLE ai_provider_models;
            DROP TABLE ai_credential_journal;
            UPDATE app_meta SET value = '2' WHERE key = 'ai_schema_version';
            CREATE TABLE ai_connection(id INTEGER PRIMARY KEY, base_url TEXT NOT NULL,
                model TEXT NOT NULL, updated_at INTEGER NOT NULL, streaming_enabled INTEGER NOT NULL);
            INSERT INTO ai_connection VALUES(1, 'https://native.example.com/v1', 'old-model', 1, 0);"
        )?;
        drop(storage);
        let original = uuid::Uuid::new_v4().to_string();
        progress("save_isolated_legacy_credential");
        credentials.save("default".into(), original.clone()).await?;
        let migrated = Storage::new(root.clone())?;
        let first = service(migrated.clone(), credentials.clone());
        progress("production_v2_migration_and_snapshot");
        require(first.get().await?.has_key, "migrated_reference_missing")?;
        let snapshot = first.request_snapshot().await?;
        require(snapshot.api_key == original && snapshot.config.model == "old-model"
            && !snapshot.config.streaming_enabled, "migrated_snapshot_mismatch")?;
        drop(snapshot);
        progress("replace_with_injected_cleanup_failure");
        credentials.fail_cleanup.store(true, Ordering::SeqCst);
        let replacement = uuid::Uuid::new_v4().to_string();
        first.save(AiConnectionInput {
            base_url: "https://native.example.com/v1".into(),
            model: "new-model".into(),
            streaming_enabled: true,
            api_key: Some(replacement.clone()),
        }).await?;
        require(journal_count(&migrated)? > 0, "cleanup_journal_missing")?;
        drop(first);
        drop(migrated);
        progress("reopen_and_recover_with_native_deletion");
        credentials.fail_cleanup.store(false, Ordering::SeqCst);
        let reopened = Storage::new(root.clone())?;
        let second = service(reopened.clone(), credentials.clone());
        second.recover().await?;
        require(journal_count(&reopened)? == 0, "journal_not_drained")?;
        require(credentials.read("default".into()).await?.is_none(), "retired_native_key_not_removed")?;
        let snapshot = second.request_snapshot().await?;
        require(snapshot.api_key == replacement && snapshot.config.model == "new-model"
            && snapshot.config.streaming_enabled, "replacement_snapshot_mismatch")?;
        second.clear().await?;
        require(journal_count(&reopened)? == 0, "final_cleanup_pending")?;
        Ok(())
    }.await;
    progress("cleanup_all_isolated_references");
    let references: Vec<_> = credentials.references.lock().iter().cloned().collect();
    let mut cleanup_error = None;
    for reference in references {
        let cleanup = async {
            credentials.native.clear(reference.clone()).await?;
            require(
                credentials.native.read(reference).await?.is_none(),
                "cleanup_not_empty",
            )
        }
        .await;
        if let Err(error) = cleanup {
            cleanup_error.get_or_insert(error);
        }
    }
    if let Some(error) = cleanup_error {
        return Err(error);
    }
    std::fs::remove_dir_all(&root).map_err(AppError::from)?;
    progress("cleanup_passed");
    result?;
    progress("passed");
    Ok(())
}

#[cfg(all(test, desktop))]
#[test]
#[ignore = "uses fresh native credential references and an isolated migration database"]
fn native_migration_and_recovery() {
    tauri::async_runtime::block_on(verify_migration(
        crate::adapters::ai::AiKeychain::default(),
        std::env::temp_dir(),
        |step| println!("native migration check: {step}"),
    ))
    .expect("native migration check failed (credential values excluded)");
}
