use super::*;
use crate::{core::activity::ActivitySink, storage::Storage};
use parking_lot::Mutex as SyncMutex;
use std::{
    collections::HashMap,
    sync::atomic::{AtomicBool, AtomicUsize, Ordering},
    time::Duration,
};
use tokio::sync::Notify;

#[derive(Default)]
struct Credentials {
    values: SyncMutex<HashMap<String, String>>,
    reads: AtomicUsize,
    clears: AtomicUsize,
    fail_read: AtomicBool,
    fail_write: AtomicBool,
    fail_delete: AtomicBool,
    hold_write: AtomicBool,
    hold_read: AtomicBool,
    read_entered: Notify,
    read_release: Notify,
    entered: Notify,
    release: Notify,
}
fn failure() -> AppError {
    AppError::external("credential:store", "Injected credential failure")
}
impl AiCredentials for Credentials {
    async fn save(&self, reference: String, key: String) -> AppResult<()> {
        if self.hold_write.load(Ordering::SeqCst) {
            self.entered.notify_one();
            self.release.notified().await;
        }
        self.values.lock().insert(reference, key);
        if self.fail_write.load(Ordering::SeqCst) {
            return Err(failure());
        }
        Ok(())
    }
    async fn read(&self, reference: String) -> AppResult<Option<String>> {
        self.reads.fetch_add(1, Ordering::SeqCst);
        if self.hold_read.load(Ordering::SeqCst) {
            self.read_entered.notify_one();
            self.read_release.notified().await;
        }
        if self.fail_read.load(Ordering::SeqCst) {
            return Err(failure());
        }
        Ok(self.values.lock().get(&reference).cloned())
    }
    async fn clear(&self, reference: String) -> AppResult<()> {
        self.clears.fetch_add(1, Ordering::SeqCst);
        if self.fail_delete.load(Ordering::SeqCst) {
            return Err(failure());
        }
        self.values.lock().remove(&reference);
        Ok(())
    }
}
#[derive(Default)]
struct Logs(SyncMutex<Vec<String>>);
impl ActivitySink for Logs {
    fn record(&self, context: &OperationContext, error: Option<&AppError>) -> AppResult<()> {
        self.0.lock().push(format!(
            "{} {} {} {:?} {:?}",
            context.source, context.action, context.address, context.detail, error
        ));
        Ok(())
    }
}
struct Fixture {
    service: Arc<AiConfigurationService<Credentials>>,
    credentials: Arc<Credentials>,
    storage: Storage,
    logs: Arc<Logs>,
    root: std::path::PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("ai-credentials-{}", uuid::Uuid::new_v4()));
        let storage = Storage::new(root.clone()).unwrap();
        let credentials = Arc::new(Credentials::default());
        let operations = Arc::new(Operations::default());
        let logs = Arc::new(Logs::default());
        let service = AiConfigurationService::new(
            AiRepository::new(storage.clone()),
            credentials.clone(),
            Executor::new(logs.clone(), operations.clone()),
            operations,
        );
        Self {
            service,
            credentials,
            storage,
            logs,
            root,
        }
    }
    fn sql(&self, sql: &str) {
        self.storage.conn().unwrap().execute_batch(sql).unwrap();
    }
    fn count(&self, table: &str) -> i64 {
        self.storage
            .conn()
            .unwrap()
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
            .unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}
fn input(address: &str, key: Option<&str>) -> AiConnectionInput {
    AiConnectionInput {
        base_url: format!("https://{address}.example.com/v1"),
        model: "model-a".into(),
        api_key: key.map(str::to_string),
        streaming_enabled: true,
    }
}

#[tokio::test]
async fn address_switch_preserves_own_credentials_and_clear_preserves_slots() {
    let f = Fixture::new();
    f.service.save(input("a", Some("secret-a"))).await.unwrap();
    assert!(!f.service.save(input("b", None)).await.unwrap().has_key);
    assert_eq!(
        f.service.request_snapshot().await.err().unwrap().code,
        "ai:api_key_missing"
    );
    f.service.save(input("b", Some("secret-b"))).await.unwrap();
    f.service.save(input("a", None)).await.unwrap();
    assert_eq!(
        f.service.request_snapshot().await.unwrap().api_key,
        "secret-a"
    );
    assert!(!f.service.clear().await.unwrap().has_key);
    assert_eq!(f.count("ai_provider_keys"), 2);
    f.service.save(input("b", None)).await.unwrap();
    assert_eq!(
        f.service.request_snapshot().await.unwrap().api_key,
        "secret-b"
    );
    let dto = serde_json::to_string(&f.service.get().await.unwrap()).unwrap();
    assert!(!dto.contains("secret-"));
    assert!(!f.logs.0.lock().join(" ").contains("secret-"));
}

#[tokio::test]
async fn invalid_input_and_unavailable_store_do_not_erase_saved_configuration() {
    let f = Fixture::new();
    f.service.save(input("a", Some("secret-a"))).await.unwrap();
    assert!(f.service.save(input("b", Some("  "))).await.is_err());
    f.credentials.fail_read.store(true, Ordering::SeqCst);
    assert!(f.service.get().await.unwrap().has_key);
    assert!(f.service.save(input("a", None)).await.unwrap().has_key);
    assert_eq!(f.credentials.reads.load(Ordering::SeqCst), 0);
    assert_eq!(
        f.service.request_snapshot().await.err().unwrap().code,
        "credential:store"
    );
    // Replacement must not require reading the old secret.
    f.service
        .save(input("a", Some("secret-new")))
        .await
        .unwrap();
    f.credentials.fail_read.store(false, Ordering::SeqCst);
    assert_eq!(
        f.service.request_snapshot().await.unwrap().api_key,
        "secret-new"
    );
    assert_eq!(f.count("ai_providers"), 1);
}

#[tokio::test]
async fn partial_credential_write_and_sql_failure_preserve_previous_selection() {
    let f = Fixture::new();
    f.service.save(input("a", Some("secret-a"))).await.unwrap();
    f.credentials.fail_write.store(true, Ordering::SeqCst);
    f.credentials.fail_delete.store(true, Ordering::SeqCst);
    assert!(f
        .service
        .save(input("b", Some("partial-secret")))
        .await
        .is_err());
    assert_eq!(f.count("ai_credential_journal"), 1);
    assert_eq!(f.count("ai_providers"), 1);
    f.credentials.fail_write.store(false, Ordering::SeqCst);
    f.credentials.fail_delete.store(false, Ordering::SeqCst);
    f.service.recover().await.unwrap();
    assert_eq!(f.credentials.values.lock().len(), 1);
    f.sql("CREATE TRIGGER fail_publish BEFORE UPDATE ON ai_settings BEGIN SELECT RAISE(ABORT, 'injected'); END;");
    assert!(f
        .service
        .save(input("b", Some("unpublished-secret")))
        .await
        .is_err());
    assert_eq!(f.count("ai_providers"), 1);
    assert_eq!(f.count("ai_credential_journal"), 0);
    assert_eq!(f.credentials.values.lock().len(), 1);
    assert_eq!(
        f.service.request_snapshot().await.unwrap().api_key,
        "secret-a"
    );
}

#[tokio::test]
async fn retired_cleanup_retries_and_never_deletes_referenced_key() {
    let f = Fixture::new();
    f.service
        .save(input("a", Some("old-secret")))
        .await
        .unwrap();
    f.credentials.fail_delete.store(true, Ordering::SeqCst);
    f.service
        .save(input("a", Some("new-secret")))
        .await
        .unwrap();
    assert_eq!(f.count("ai_credential_journal"), 1);
    assert_eq!(
        f.service.request_snapshot().await.unwrap().api_key,
        "new-secret"
    );
    f.credentials.fail_delete.store(false, Ordering::SeqCst);
    f.service.recover().await.unwrap();
    assert_eq!(f.credentials.values.lock().len(), 1);
    f.sql("INSERT INTO ai_credential_journal SELECT credential_ref, 'corrupt', 'retired', 1 FROM ai_provider_keys WHERE credential_ref IS NOT NULL;");
    assert!(f.service.recover().await.is_err());
    assert_eq!(f.credentials.values.lock().len(), 1);
    assert_eq!(f.count("ai_credential_journal"), 1);
}

#[tokio::test]
async fn default_adoption_and_reset_cleanup_survive_reopen() {
    let f = Fixture::new();
    f.credentials
        .values
        .lock()
        .insert("default".into(), "legacy-secret".into());
    assert!(f.service.save(input("a", None)).await.unwrap().has_key);
    assert_eq!(
        f.service.request_snapshot().await.unwrap().api_key,
        "legacy-secret"
    );
    f.credentials.fail_delete.store(true, Ordering::SeqCst);
    let lease = Arc::new(f.service.executor.maintenance().await.unwrap());
    f.storage.reset_database().unwrap();
    assert!(f.service.cleanup_after_reset(lease).await.is_err());
    assert!(!f.service.save(input("b", None)).await.unwrap().has_key);
    assert_eq!(f.count("ai_credential_journal"), 1);
    let reopened = Storage::new(f.root.clone()).unwrap();
    let service = AiConfigurationService::new(
        AiRepository::new(reopened),
        f.credentials.clone(),
        f.service.executor.clone(),
        f.service.operations.clone(),
    );
    f.credentials.fail_delete.store(false, Ordering::SeqCst);
    service.recover().await.unwrap();
    assert!(f.credentials.values.lock().is_empty());
    assert_eq!(f.count("ai_credential_journal"), 0);
}

#[tokio::test]
async fn abandoned_waiter_keeps_maintenance_blocked_and_snapshot_consistent() {
    let f = Fixture::new();
    f.service.save(input("a", Some("secret-a"))).await.unwrap();
    f.credentials.hold_write.store(true, Ordering::SeqCst);
    let service = f.service.clone();
    let waiter = tokio::spawn(async move { service.save(input("b", Some("secret-b"))).await });
    tokio::time::timeout(Duration::from_secs(3), f.credentials.entered.notified())
        .await
        .unwrap();
    waiter.abort();
    assert!(f
        .service
        .operations
        .maintenance(Duration::from_millis(20))
        .await
        .is_err());
    let service = f.service.clone();
    let snapshot = tokio::spawn(async move { service.request_snapshot().await });
    assert!(!snapshot.is_finished());
    f.credentials.release.notify_one();
    let snapshot = tokio::time::timeout(Duration::from_secs(3), snapshot)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert!(snapshot.config.base_url.contains("b.example.com"));
    assert_eq!(snapshot.api_key, "secret-b");
    let _lease = f
        .service
        .operations
        .maintenance(Duration::from_secs(3))
        .await
        .unwrap();
}

#[tokio::test]
async fn compatibility_limits_reject_without_orphan_credentials() {
    let f = Fixture::new();
    for n in 0..5 {
        f.service.save(input(&format!("p{n}"), None)).await.unwrap();
    }
    assert!(f
        .service
        .save(input("overflow", Some("unused-secret")))
        .await
        .is_err());
    for n in 0..9 {
        let mut value = input("p0", None);
        value.model = format!("model-{n}");
        f.service.save(value).await.unwrap();
    }
    let mut value = input("p0", Some("unused-secret"));
    value.model = "overflow".into();
    assert!(f.service.save(value).await.is_err());
    assert_eq!(f.count("ai_providers"), 5);
    assert_eq!(f.count("ai_credential_journal"), 0);
    assert!(f.credentials.values.lock().is_empty());
}

#[tokio::test]
async fn explicit_first_key_and_empty_clear_retire_orphan_default() {
    for replace in [false, true] {
        let f = Fixture::new();
        f.credentials
            .values
            .lock()
            .insert("default".into(), "orphan".into());
        if replace {
            f.service
                .save(input("a", Some("new-secret")))
                .await
                .unwrap();
        } else {
            f.service.clear().await.unwrap();
            assert!(!f.service.save(input("a", None)).await.unwrap().has_key);
        }
        assert!(!f.credentials.values.lock().contains_key("default"));
        assert_eq!(f.count("ai_credential_journal"), 0);
    }
}

#[tokio::test]
async fn migrated_default_missing_and_unavailable_are_distinct() {
    let f = Fixture::new();
    // Recreate a v2 database to exercise the production Storage migration path.
    f.sql(
        "DROP TABLE ai_settings; DROP TABLE ai_providers;
        DROP TABLE ai_provider_keys; DROP TABLE ai_provider_models;
        DROP TABLE ai_credential_journal;
        UPDATE app_meta SET value = '2' WHERE key = 'ai_schema_version';
        CREATE TABLE ai_connection(id INTEGER PRIMARY KEY, base_url TEXT NOT NULL,
            model TEXT NOT NULL, updated_at INTEGER NOT NULL, streaming_enabled INTEGER NOT NULL);
        INSERT INTO ai_connection VALUES(1, 'https://a.example.com/v1', 'old-model', 1, 0);",
    );
    let migrated = Storage::new(f.root.clone()).unwrap();
    let service = AiConfigurationService::new(
        AiRepository::new(migrated),
        f.credentials.clone(),
        f.service.executor.clone(),
        f.service.operations.clone(),
    );
    assert!(service.get().await.unwrap().has_key);
    assert_eq!(f.credentials.reads.load(Ordering::SeqCst), 0);
    assert_eq!(
        service.request_snapshot().await.err().unwrap().code,
        "ai:api_key_missing"
    );
    f.credentials
        .values
        .lock()
        .insert("default".into(), "legacy-secret".into());
    let snapshot = service.request_snapshot().await.unwrap();
    assert_eq!(snapshot.api_key, "legacy-secret");
    assert_eq!(snapshot.config.model, "old-model");
    assert!(!snapshot.config.streaming_enabled);
    f.credentials.fail_read.store(true, Ordering::SeqCst);
    let reads = f.credentials.reads.load(Ordering::SeqCst);
    assert!(service.get().await.unwrap().has_key);
    assert!(service.save(input("a", None)).await.unwrap().has_key);
    assert_eq!(f.credentials.reads.load(Ordering::SeqCst), reads);
    assert_eq!(
        service.request_snapshot().await.err().unwrap().code,
        "credential:store"
    );
    assert_eq!(f.credentials.values.lock().len(), 1);
}

#[path = "management_tests.rs"]
mod management;

#[path = "selection_tests.rs"]
mod selection;
