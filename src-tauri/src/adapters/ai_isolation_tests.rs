use super::{memory::MemoryCredentialBuilder, *};
use crate::{
    adapters::activity_log::StorageActivityLog,
    core::{execution::Executor, operations::Operations},
    modules::ai::{
        configuration::input::AiProviderCreateInput, AiConfigurationService, AiRepository,
    },
    storage::Storage,
};
use keyring::credential::CredentialBuilderApi;

const PRODUCTION: &str = "com.imehc.mftp";
const QA: &str = "com.imehc.mftp.qa";
const DEVELOPMENT: &str = "com.imehc.mftp.dev";

fn keychain(identifier: &str, store: &MemoryCredentialBuilder) -> AiKeychain {
    AiKeychain::with_builder(identifier, Arc::new(store.clone()))
}

#[test]
fn installation_uses_final_tauri_identifier_and_preserves_production_service() {
    let production: serde_json::Value =
        serde_json::from_str(include_str!("../../tauri.conf.json")).unwrap();
    let qa: serde_json::Value =
        serde_json::from_str(include_str!("../../tauri.qa.conf.json")).unwrap();
    assert_eq!(production["identifier"], PRODUCTION);
    assert_eq!(qa["identifier"], QA);
    assert_eq!(qa["plugins"]["updater"]["endpoints"], serde_json::json!([]));
    assert_eq!(qa["bundle"]["createUpdaterArtifacts"], false);
    for identifier in [PRODUCTION, QA, DEVELOPMENT] {
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        context.config_mut().identifier = identifier.into();
        let app = tauri::test::mock_builder().build(context).unwrap();
        // Constructing the builder performs no native read, write or authentication.
        let credentials = AiKeychain::install(app.handle());
        assert_eq!(credentials.service, format!("{identifier}.ai"));
    }
}

#[tokio::test]
async fn existing_production_legacy_and_uuid_accounts_remain_readable() {
    let store = MemoryCredentialBuilder::default();
    let production = keychain(PRODUCTION, &store);
    for reference in [
        "default".to_string(),
        format!("ai-{}", uuid::Uuid::new_v4()),
    ] {
        // Seed the old exact service/account pair, before the scoped adapter exists.
        store
            .build(None, "com.imehc.mftp.ai", &reference)
            .unwrap()
            .set_password("existing-production-value")
            .unwrap();
        assert!(
            production.read(reference).await.unwrap().as_deref()
                == Some("existing-production-value")
        );
    }
}

#[tokio::test]
async fn identical_accounts_are_isolated_for_overwrite_delete_and_reopen() {
    let store = MemoryCredentialBuilder::default();
    let production = keychain(PRODUCTION, &store);
    let qa = keychain(QA, &store);
    let second = keychain(DEVELOPMENT, &store);
    for reference in [
        "default".to_string(),
        format!("ai-{}", uuid::Uuid::new_v4()),
    ] {
        production
            .save(reference.clone(), "production".into())
            .await
            .unwrap();
        assert!(qa.read(reference.clone()).await.unwrap().is_none());
        qa.save(reference.clone(), "qa".into()).await.unwrap();
        second
            .save(reference.clone(), "second".into())
            .await
            .unwrap();
        qa.save(reference.clone(), "replacement".into())
            .await
            .unwrap();
        let reopened = keychain(QA, &store);
        assert!(reopened.read(reference.clone()).await.unwrap().as_deref() == Some("replacement"));
        reopened.clear(reference.clone()).await.unwrap();
        reopened.clear(reference.clone()).await.unwrap();
        assert!(qa.read(reference.clone()).await.unwrap().is_none());
        assert!(production.read(reference.clone()).await.unwrap().as_deref() == Some("production"));
        assert!(second.read(reference).await.unwrap().as_deref() == Some("second"));
    }
}

#[tokio::test]
async fn failed_qa_operations_never_fall_back_or_leak_native_diagnostics() {
    let store = MemoryCredentialBuilder::default();
    let production = keychain(PRODUCTION, &store);
    production
        .save("default".into(), "production".into())
        .await
        .unwrap();
    let qa = keychain(QA, &store);
    let before = store.calls().len();
    store.fail_service(Some("com.imehc.mftp.qa.ai"));
    let errors = [
        qa.read("default".into()).await.unwrap_err(),
        qa.save("default".into(), "replacement".into())
            .await
            .unwrap_err(),
        qa.clear("default".into()).await.unwrap_err(),
    ];
    for error in errors {
        assert_eq!(error.code, "credential:store");
        assert!(!format!("{error:?}").contains("private-test-secret"));
    }
    let calls = store.calls();
    assert_eq!(calls.len() - before, 3);
    assert!(calls[before..]
        .iter()
        .all(|(_, (service, _))| service == "com.imehc.mftp.qa.ai"));
    assert!(production.read("default".into()).await.unwrap().as_deref() == Some("production"));
}

struct ResetFixture {
    storage: Storage,
    root: std::path::PathBuf,
}

impl ResetFixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("ai-namespace-{}", uuid::Uuid::new_v4()));
        Self {
            storage: Storage::new(root.clone()).unwrap(),
            root,
        }
    }

    fn service(&self, credentials: AiKeychain) -> Arc<AiConfigurationService<AiKeychain>> {
        let operations = Arc::new(Operations::default());
        let executor = Executor::new(
            Arc::new(StorageActivityLog(self.storage.clone())),
            operations.clone(),
        );
        AiConfigurationService::new(
            AiRepository::new(self.storage.clone()),
            Arc::new(credentials),
            executor,
            operations,
        )
    }

    fn pending(&self) -> i64 {
        rusqlite::Connection::open(self.storage.db_path())
            .unwrap()
            .query_row("SELECT COUNT(*) FROM ai_credential_journal", [], |row| {
                row.get(0)
            })
            .unwrap()
    }
}

impl Drop for ResetFixture {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.root).unwrap();
    }
}

#[tokio::test]
async fn reset_journal_recovery_after_reopen_only_clears_qa_credentials() {
    let store = MemoryCredentialBuilder::default();
    let production = keychain(PRODUCTION, &store);
    let qa = keychain(QA, &store);
    let mut fixture = ResetFixture::new();
    let service = fixture.service(qa.clone());
    let view = service
        .create_provider(AiProviderCreateInput {
            protocol: Default::default(),
            expected_revision: 0,
            name: "QA".into(),
            base_url: "https://qa.example.com/v1".into(),
            key_label: "Key".into(),
            api_key: "qa-secret".into(),
            model_id: "model".into(),
            display_name: None,
        })
        .await
        .unwrap();
    assert!(!serde_json::to_string(&view).unwrap().contains("qa-secret"));
    let reference: String = rusqlite::Connection::open(fixture.storage.db_path())
        .unwrap()
        .query_row("SELECT credential_ref FROM ai_provider_keys", [], |row| {
            row.get(0)
        })
        .unwrap();
    for account in ["default".to_string(), reference.clone()] {
        production
            .save(account, "production-secret".into())
            .await
            .unwrap();
    }
    qa.save("default".into(), "qa-legacy".into()).await.unwrap();
    fixture.storage.reset_database().unwrap();
    assert_eq!(fixture.pending(), 2);
    store.fail_service(Some("com.imehc.mftp.qa.ai"));
    assert_eq!(
        service.recover().await.unwrap_err().code,
        "credential:store"
    );
    assert_eq!(fixture.pending(), 2);
    drop(service);
    // Recreate storage and the service, as after a process exit. Only the
    // existing credential journal is recovered; reset itself is not replayed.
    fixture.storage = Storage::new(fixture.root.clone()).unwrap();
    store.fail_service(None);
    let recovered = fixture.service(keychain(QA, &store));
    let before = store.calls().len();
    recovered.recover().await.unwrap();
    assert_eq!(fixture.pending(), 0);
    assert!(recovered
        .configuration()
        .await
        .unwrap()
        .providers
        .is_empty());
    let calls = store.calls();
    assert_eq!(calls.len() - before, 2);
    assert!(calls[before..]
        .iter()
        .all(|(action, (service, _))| action == "delete" && service == "com.imehc.mftp.qa.ai"));
    for account in ["default".to_string(), reference] {
        assert!(qa.read(account.clone()).await.unwrap().is_none());
        assert!(production.read(account).await.unwrap().as_deref() == Some("production-secret"));
    }
}

#[tokio::test]
async fn native_migration_scenario_also_runs_with_memory_backend() {
    super::tests::native_migration::verify_migration(
        AiKeychain::in_memory(),
        std::env::temp_dir(),
        |_| {},
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn ordinary_fixtures_keep_private_memory_stores() {
    let first = AiKeychain::in_memory();
    let second = AiKeychain::in_memory();
    assert_ne!(first.service, second.service);
    first.save("default".into(), "first".into()).await.unwrap();
    assert!(second.read("default".into()).await.unwrap().is_none());
    super::tests::native::verify_roundtrip(&first, |_| {})
        .await
        .unwrap();
}
