use super::*;
use crate::modules::ai::configuration::{input::*, model::*};

pub(super) fn create(revision: i64, name: &str) -> AiProviderCreateInput {
    AiProviderCreateInput {
        expected_revision: revision,
        name: name.into(),
        base_url: format!("https://{name}.example.com/v1"),
        key_label: " personal ".into(),
        api_key: format!("private-secret-{name}"),
        model_id: " model-a ".into(),
        display_name: Some(" Fast ".into()),
    }
}
pub(super) fn key_save(
    v: &AiConfigurationView,
    provider: &str,
    id: Option<String>,
    label: &str,
    secret: Option<&str>,
) -> AiKeySaveInput {
    AiKeySaveInput {
        expected_revision: v.revision,
        provider_id: provider.into(),
        key_id: id,
        label: label.into(),
        replacement_secret: secret.map(str::to_string),
    }
}
pub(super) fn model_save(v: &AiConfigurationView, provider: &str, model: &str) -> AiModelSaveInput {
    AiModelSaveInput {
        expected_revision: v.revision,
        provider_id: provider.into(),
        id: None,
        model_id: model.into(),
        display_name: None,
    }
}

#[tokio::test]
async fn create_is_atomic_and_additions_do_not_change_selection() {
    let f = Fixture::new();
    let a = f.service.create_provider(create(0, "a")).await.unwrap();
    let p = &a.providers[0];
    assert_eq!(a.active_provider_id.as_ref(), Some(&p.id));
    assert_eq!(p.keys[0].label, "personal");
    assert_eq!(p.models[0].model_id, "model-a");
    assert_eq!(p.models[0].display_name.as_deref(), Some("Fast"));
    let b = f
        .service
        .create_provider(create(a.revision, "b"))
        .await
        .unwrap();
    assert_eq!(b.active_provider_id, a.active_provider_id);
    let added = f
        .service
        .save_key(key_save(&b, &p.id, None, "work", Some("private-work")))
        .await
        .unwrap();
    let v = f
        .service
        .save_model(model_save(&added, &p.id, "model-b"))
        .await
        .unwrap();
    let updated = v.providers.iter().find(|row| row.id == p.id).unwrap();
    assert_eq!(updated.current_key_id, p.current_key_id);
    assert_eq!(updated.current_model_id, p.current_model_id);
    assert_eq!(v.label_candidates, ["personal", "work"]);
    assert_eq!(v.model_candidates, ["model-a", "model-b"]);
    assert_eq!(
        f.service.request_snapshot().await.unwrap().api_key,
        "private-secret-a"
    );
    let reopened = Storage::new(f.root.clone()).unwrap();
    assert_eq!(AiRepository::new(reopened).configuration().unwrap(), v);
    let public = serde_json::to_string(&v).unwrap();
    assert!(!public.contains("private-"));
    assert!(!public.contains("credential"));
    assert!(!f.logs.0.lock().join(" ").contains("private-"));
}

#[tokio::test]
async fn metadata_list_never_reads_or_cleans_credentials() {
    let f = Fixture::new();
    f.credentials.fail_read.store(true, Ordering::SeqCst);
    f.credentials.fail_delete.store(true, Ordering::SeqCst);
    f.sql("INSERT INTO ai_credential_journal VALUES('default', 'pending', 'retired', 1);");
    let v = f.service.configuration().await.unwrap();
    assert!(v.providers.is_empty());
    assert_eq!(f.count("ai_credential_journal"), 1);
    assert!(f.logs.0.lock().is_empty());
    assert_eq!(f.credentials.reads.load(Ordering::SeqCst), 0);
    assert_eq!(f.credentials.clears.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn noncurrent_edits_and_null_secret_keep_identity_and_do_not_activate() {
    let f = Fixture::new();
    let a = f.service.create_provider(create(0, "a")).await.unwrap();
    let b = f
        .service
        .create_provider(create(a.revision, "b"))
        .await
        .unwrap();
    let p = b.providers.iter().find(|p| p.name == "b").unwrap();
    let key = p.keys[0].id.clone();
    f.credentials.fail_read.store(true, Ordering::SeqCst);
    let v = f
        .service
        .save_key(key_save(&b, &p.id, Some(key.clone()), " renamed ", None))
        .await
        .unwrap();
    let v = f
        .service
        .update_provider(AiProviderUpdateInput {
            expected_revision: v.revision,
            provider_id: p.id.clone(),
            name: " Updated ".into(),
            base_url: "https://new.example.com/v1".into(),
        })
        .await
        .unwrap();
    let updated = v.providers.iter().find(|row| row.id == p.id).unwrap();
    assert_eq!(updated.keys[0].id, key);
    assert_eq!(updated.keys[0].label, "renamed");
    assert_eq!(updated.name, "Updated");
    assert_eq!(v.active_provider_id, a.active_provider_id);
    assert_eq!(f.credentials.values.lock().len(), 2);
    assert!(f
        .credentials
        .values
        .lock()
        .values()
        .any(|key| key == "private-secret-b"));
}

#[tokio::test]
async fn concurrent_revision_allows_only_one_publish_and_rejects_stale_old_ui_updates() {
    let f = Fixture::new();
    let (a, b) = tokio::join!(
        f.service.create_provider(create(0, "a")),
        f.service.create_provider(create(0, "b"))
    );
    assert_ne!(a.is_ok(), b.is_ok());
    let error = if let Err(error) = a {
        error
    } else {
        b.unwrap_err()
    };
    assert_eq!(error.code, "ai:revision_conflict");
    assert_eq!(f.count("ai_providers"), 1);
    assert_eq!(f.credentials.values.lock().len(), 1);
    let v = f.service.configuration().await.unwrap();
    let p = &v.providers[0];
    let stale = key_save(
        &v,
        &p.id,
        Some(p.keys[0].id.clone()),
        "stale",
        Some("private-unused"),
    );
    f.service.save(input("legacy", None)).await.unwrap();
    assert_eq!(
        f.service.save_key(stale).await.unwrap_err().code,
        "ai:revision_conflict"
    );
    assert_eq!(f.count("ai_credential_journal"), 0);
    assert!(!f
        .credentials
        .values
        .lock()
        .values()
        .any(|key| key == "private-unused"));
}

#[tokio::test]
async fn create_and_replace_failures_keep_old_state_and_retry_journal() {
    let f = Fixture::new();
    let original = f.service.create_provider(create(0, "a")).await.unwrap();
    f.credentials.fail_write.store(true, Ordering::SeqCst);
    f.credentials.fail_delete.store(true, Ordering::SeqCst);
    assert!(f
        .service
        .create_provider(create(original.revision, "b"))
        .await
        .is_err());
    assert_eq!(f.service.configuration().await.unwrap(), original);
    assert_eq!(f.count("ai_credential_journal"), 1);
    f.credentials.fail_write.store(false, Ordering::SeqCst);
    f.credentials.fail_delete.store(false, Ordering::SeqCst);
    f.service.recover().await.unwrap();
    f.sql("CREATE TRIGGER fail_configuration BEFORE UPDATE ON ai_settings BEGIN SELECT RAISE(ABORT, 'injected'); END;");
    assert!(f
        .service
        .create_provider(create(original.revision, "b"))
        .await
        .is_err());
    let p = &original.providers[0];
    assert!(f
        .service
        .save_key(key_save(
            &original,
            &p.id,
            Some(p.keys[0].id.clone()),
            "new",
            Some("private-unused")
        ))
        .await
        .is_err());
    assert_eq!(f.service.configuration().await.unwrap(), original);
    assert_eq!(f.credentials.values.lock().len(), 1);
    assert_eq!(f.count("ai_credential_journal"), 0);
}

#[tokio::test]
async fn replacement_and_provider_deletion_commit_even_if_cleanup_needs_retry() {
    let f = Fixture::new();
    let a = f.service.create_provider(create(0, "a")).await.unwrap();
    let b = f
        .service
        .create_provider(create(a.revision, "b"))
        .await
        .unwrap();
    let p = &a.providers[0];
    let old_request = f.service.request_snapshot().await.unwrap();
    f.credentials.fail_delete.store(true, Ordering::SeqCst);
    let v = f
        .service
        .save_key(key_save(
            &b,
            &p.id,
            Some(p.keys[0].id.clone()),
            "new",
            Some("private-new"),
        ))
        .await
        .unwrap();
    assert_eq!(f.count("ai_credential_journal"), 1);
    let deleted = f
        .service
        .delete_provider(AiProviderDeleteInput {
            expected_revision: v.revision,
            provider_id: p.id.clone(),
        })
        .await
        .unwrap();
    assert_eq!(deleted.active_provider_id, None);
    assert_eq!(deleted.providers.len(), 1);
    assert_eq!(old_request.api_key, "private-secret-a");
    assert_eq!(f.count("ai_credential_journal"), 2);
    f.credentials.fail_delete.store(false, Ordering::SeqCst);
    f.service.recover().await.unwrap();
    assert_eq!(
        f.credentials
            .values
            .lock()
            .values()
            .cloned()
            .collect::<Vec<_>>(),
        ["private-secret-b"]
    );
    assert_eq!(f.count("ai_credential_journal"), 0);
}

#[tokio::test]
async fn canceled_management_write_retains_maintenance_and_serializes_next_request() {
    let f = Fixture::new();
    f.credentials.hold_write.store(true, Ordering::SeqCst);
    let service = f.service.clone();
    let waiter = tokio::spawn(async move { service.create_provider(create(0, "a")).await });
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
    let read = tokio::spawn(async move { service.configuration().await });
    f.credentials.release.notify_one();
    let view = tokio::time::timeout(Duration::from_secs(3), read)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert_eq!(view.providers.len(), 1);
    assert_eq!(view.providers[0].name, "a");
    let _lease = f
        .service
        .operations
        .maintenance(Duration::from_secs(3))
        .await
        .unwrap();
}

#[test]
fn malformed_secret_inputs_never_echo_the_value() {
    for bad in [
        serde_json::json!({"private-secret": 1}),
        serde_json::json!(["private-secret"]),
    ] {
        let value = serde_json::json!({"expectedRevision": 0, "name": "a", "baseUrl": "https://a.example.com", "keyLabel": "work", "apiKey": bad, "modelId": "a"});
        let error = serde_json::from_value::<AiProviderCreateInput>(value)
            .err()
            .unwrap();
        assert!(!error.to_string().contains("private-secret"));
        let value = serde_json::json!({"expectedRevision": 0, "providerId": "a", "label": "work", "replacementSecret": bad});
        let error = serde_json::from_value::<AiKeySaveInput>(value)
            .err()
            .unwrap();
        assert!(!error.to_string().contains("private-secret"));
    }
}

#[path = "management_constraints_tests.rs"]
mod constraints;
