use super::management::{create, key_save, model_save};
use super::*;
use crate::modules::ai::configuration::{input::*, model::*};

fn target(view: &AiConfigurationView, id: &str) -> AiProviderTargetInput {
    AiProviderTargetInput {
        expected_revision: view.revision,
        provider_id: id.into(),
    }
}
fn switch(view: &AiConfigurationView, provider: &str, model: &str) -> AiModelSwitchInput {
    AiModelSwitchInput {
        expected_revision: view.revision,
        expected_active_provider_id: provider.into(),
        model_id: model.into(),
    }
}
fn options(
    view: &AiConfigurationView,
    provider: &str,
    key: &str,
    model: &str,
) -> AiProviderSelectionInput {
    AiProviderSelectionInput {
        expected_revision: view.revision,
        provider_id: provider.into(),
        current_key_id: key.into(),
        current_model_id: model.into(),
    }
}

#[tokio::test]
async fn a_b_a_restores_each_choice_and_global_streaming_survives_reopen() {
    let f = Fixture::new();
    let a = f.service.create_provider(create(0, "a")).await.unwrap();
    let pa = a.providers[0].clone();
    let b = f
        .service
        .create_provider(create(a.revision, "b"))
        .await
        .unwrap();
    let pb = b.providers.iter().find(|p| p.name == "b").unwrap().clone();
    let b = f
        .service
        .save_key(key_save(
            &b,
            &pb.id,
            None,
            "second",
            Some("private-b-second"),
        ))
        .await
        .unwrap();
    let b = f
        .service
        .save_model(model_save(&b, &pb.id, "model-b-second"))
        .await
        .unwrap();
    let p = b.providers.iter().find(|p| p.id == pb.id).unwrap();
    let key = p
        .keys
        .iter()
        .find(|k| k.label == "second")
        .unwrap()
        .id
        .clone();
    let model = p
        .models
        .iter()
        .find(|m| m.model_id == "model-b-second")
        .unwrap()
        .id
        .clone();
    let b = f
        .service
        .select_provider_options(options(&b, &pb.id, &key, &model))
        .await
        .unwrap();
    assert_eq!(b.active_provider_id, a.active_provider_id);
    let before_stream = b.providers.clone();
    let b = f
        .service
        .update_streaming(AiStreamingUpdateInput {
            expected_revision: b.revision,
            streaming_enabled: false,
        })
        .await
        .unwrap();
    assert_eq!(b.providers, before_stream);
    let b = f
        .service
        .activate_provider(target(&b, &pb.id))
        .await
        .unwrap();
    let request = f.service.request_snapshot().await.unwrap();
    assert_eq!(request.api_key, "private-b-second");
    assert_eq!(request.config.model, "model-b-second");
    assert!(!request.config.streaming_enabled);
    let a = f
        .service
        .activate_provider(target(&b, &pa.id))
        .await
        .unwrap();
    assert_eq!(a.providers, b.providers);
    let request = f.service.request_snapshot().await.unwrap();
    assert_eq!(request.api_key, "private-secret-a");
    assert_eq!(request.config.model, "model-a");
    assert!(!request.config.streaming_enabled);
    let b = f
        .service
        .activate_provider(target(&a, &pb.id))
        .await
        .unwrap();
    let reopened = AiRepository::new(Storage::new(f.root.clone()).unwrap())
        .configuration()
        .unwrap();
    assert_eq!(reopened, b);
    assert_eq!(
        f.service.request_snapshot().await.unwrap().api_key,
        "private-b-second"
    );
}

#[tokio::test]
async fn quick_switch_checks_current_address_revision_and_model_ownership() {
    let f = Fixture::new();
    let a = f.service.create_provider(create(0, "a")).await.unwrap();
    let pa = &a.providers[0];
    let b = f
        .service
        .create_provider(create(a.revision, "b"))
        .await
        .unwrap();
    let pb = b.providers.iter().find(|p| p.name == "b").unwrap();
    assert_eq!(
        f.service
            .switch_current_model(switch(&b, &pb.id, &pb.models[0].id))
            .await
            .unwrap_err()
            .code,
        "ai:active_provider_changed"
    );
    assert_eq!(
        f.service
            .switch_current_model(switch(&b, &pa.id, &pb.models[0].id))
            .await
            .unwrap_err()
            .code,
        "ai:model_not_found"
    );
    assert_eq!(
        f.service
            .select_provider_options(options(&b, &pa.id, &pb.keys[0].id, &pa.models[0].id))
            .await
            .unwrap_err()
            .code,
        "ai:key_not_found"
    );
    assert_eq!(
        f.service
            .select_provider_options(options(&b, &pa.id, &pa.keys[0].id, &pb.models[0].id))
            .await
            .unwrap_err()
            .code,
        "ai:model_not_found"
    );
    assert_eq!(f.service.configuration().await.unwrap(), b);
    let v = f
        .service
        .save_model(model_save(&b, &pa.id, "quick"))
        .await
        .unwrap();
    let quick = v
        .providers
        .iter()
        .find(|p| p.id == pa.id)
        .unwrap()
        .models
        .iter()
        .find(|m| m.model_id == "quick")
        .unwrap()
        .id
        .clone();
    let v = f
        .service
        .switch_current_model(switch(&v, &pa.id, &quick))
        .await
        .unwrap();
    assert_eq!(
        v.providers
            .iter()
            .find(|p| p.id == pa.id)
            .unwrap()
            .current_key_id,
        pa.current_key_id
    );
    assert_eq!(
        f.service.request_snapshot().await.unwrap().config.model,
        "quick"
    );
    assert_eq!(
        f.service
            .switch_current_model(switch(&b, &pa.id, &pa.models[0].id))
            .await
            .unwrap_err()
            .code,
        "ai:revision_conflict"
    );
    f.storage.reset_database().unwrap();
    let empty = f.service.configuration().await.unwrap();
    assert_eq!(
        f.service
            .switch_current_model(switch(&empty, &pa.id, &quick))
            .await
            .unwrap_err()
            .code,
        "ai:active_provider_changed"
    );
}

#[tokio::test]
async fn activation_checks_metadata_without_credential_io_and_rejects_incomplete_data() {
    let f = Fixture::new();
    let a = f.service.create_provider(create(0, "a")).await.unwrap();
    let p = &a.providers[0];
    f.credentials.fail_read.store(true, Ordering::SeqCst);
    f.credentials.fail_delete.store(true, Ordering::SeqCst);
    let reads = f.credentials.reads.load(Ordering::SeqCst);
    let clears = f.credentials.clears.load(Ordering::SeqCst);
    let v = f
        .service
        .activate_provider(target(&a, &p.id))
        .await
        .unwrap();
    let v = f
        .service
        .select_provider_options(options(&v, &p.id, &p.keys[0].id, &p.models[0].id))
        .await
        .unwrap();
    let v = f
        .service
        .switch_current_model(switch(&v, &p.id, &p.models[0].id))
        .await
        .unwrap();
    let v = f
        .service
        .update_streaming(AiStreamingUpdateInput {
            expected_revision: v.revision,
            streaming_enabled: false,
        })
        .await
        .unwrap();
    assert_eq!(f.credentials.reads.load(Ordering::SeqCst), reads);
    assert_eq!(f.credentials.clears.load(Ordering::SeqCst), clears);
    assert_eq!(
        f.service
            .test_provider(target(&v, &p.id))
            .await
            .unwrap_err()
            .code,
        "credential:store"
    );
    f.sql("UPDATE ai_provider_keys SET credential_ref = NULL;");
    assert_eq!(
        f.service
            .activate_provider(target(&v, &p.id))
            .await
            .unwrap_err()
            .code,
        "ai:api_key_missing"
    );
    f.sql("UPDATE ai_providers SET base_url = 'http://unsafe.example.com';");
    assert_eq!(
        f.service
            .activate_provider(target(&v, &p.id))
            .await
            .unwrap_err()
            .code,
        "ai:address_invalid"
    );
    assert_eq!(
        f.service
            .activate_provider(target(&v, "missing"))
            .await
            .unwrap_err()
            .code,
        "ai:provider_not_found"
    );
    assert_eq!(
        f.service.configuration().await.unwrap().revision,
        v.revision
    );
}

#[tokio::test]
async fn concurrent_activation_and_quick_switch_publish_only_one_revision() {
    let f = Fixture::new();
    let a = f.service.create_provider(create(0, "a")).await.unwrap();
    let pa = &a.providers[0];
    let b = f
        .service
        .create_provider(create(a.revision, "b"))
        .await
        .unwrap();
    let pb = b.providers.iter().find(|p| p.name == "b").unwrap();
    let (activate, quick) = tokio::join!(
        f.service.activate_provider(target(&b, &pb.id)),
        f.service
            .switch_current_model(switch(&b, &pa.id, &pa.models[0].id))
    );
    assert_ne!(activate.is_ok(), quick.is_ok());
    let error = if let Err(error) = activate {
        error
    } else {
        quick.unwrap_err()
    };
    assert_eq!(error.code, "ai:revision_conflict");
    assert_eq!(
        f.service.configuration().await.unwrap().revision,
        b.revision + 1
    );
}

#[tokio::test]
async fn failed_selection_transaction_does_not_change_preferences_or_revision() {
    let f = Fixture::new();
    let a = f.service.create_provider(create(0, "a")).await.unwrap();
    let p = &a.providers[0];
    let v = f
        .service
        .save_model(model_save(&a, &p.id, "other"))
        .await
        .unwrap();
    let m = v.providers[0]
        .models
        .iter()
        .find(|m| m.model_id == "other")
        .unwrap();
    f.sql("CREATE TRIGGER fail_revision BEFORE UPDATE ON ai_settings BEGIN SELECT RAISE(ABORT, 'injected'); END;");
    assert!(f
        .service
        .select_provider_options(options(&v, &p.id, &p.keys[0].id, &m.id))
        .await
        .is_err());
    assert!(f
        .service
        .switch_current_model(switch(&v, &p.id, &m.id))
        .await
        .is_err());
    assert!(f
        .service
        .update_streaming(AiStreamingUpdateInput {
            expected_revision: v.revision,
            streaming_enabled: false
        })
        .await
        .is_err());
    assert_eq!(f.service.configuration().await.unwrap(), v);
}

#[tokio::test]
async fn targeted_test_rejects_stale_and_missing_without_accessing_keys() {
    let f = Fixture::new();
    let v = f.service.create_provider(create(0, "a")).await.unwrap();
    let p = &v.providers[0];
    assert_eq!(
        f.service
            .test_provider(AiProviderTargetInput {
                expected_revision: 0,
                provider_id: p.id.clone()
            })
            .await
            .unwrap_err()
            .code,
        "ai:revision_conflict"
    );
    assert_eq!(
        f.service
            .test_provider(target(&v, "missing"))
            .await
            .unwrap_err()
            .code,
        "ai:provider_not_found"
    );
    assert_eq!(f.credentials.reads.load(Ordering::SeqCst), 0);
    f.credentials.values.lock().clear();
    assert_eq!(
        f.service
            .test_provider(target(&v, &p.id))
            .await
            .unwrap_err()
            .code,
        "ai:api_key_missing"
    );
    assert_eq!(f.service.configuration().await.unwrap(), v);
    f.sql("UPDATE ai_settings SET revision = 9007199254740991;");
    let max = f.service.configuration().await.unwrap();
    assert_eq!(
        f.service
            .test_provider(target(&max, &p.id))
            .await
            .unwrap_err()
            .code,
        "ai:api_key_missing"
    );
}

#[path = "selection_network_tests.rs"]
mod network;

#[tokio::test]
async fn selection_waits_for_pending_credential_read_without_mixing_snapshot() {
    let f = Fixture::new();
    let a = f.service.create_provider(create(0, "a")).await.unwrap();
    let b = f
        .service
        .create_provider(create(a.revision, "b"))
        .await
        .unwrap();
    let pb = b.providers.iter().find(|p| p.name == "b").unwrap();
    f.credentials.hold_read.store(true, Ordering::SeqCst);
    let service = f.service.clone();
    let read = tokio::spawn(async move { service.request_snapshot().await });
    tokio::time::timeout(
        Duration::from_secs(3),
        f.credentials.read_entered.notified(),
    )
    .await
    .unwrap();
    let service = f.service.clone();
    let input = target(&b, &pb.id);
    let select = tokio::spawn(async move { service.activate_provider(input).await });
    f.credentials.hold_read.store(false, Ordering::SeqCst);
    f.credentials.read_release.notify_one();
    let snapshot = read.await.unwrap().unwrap();
    assert!(snapshot.config.base_url.contains("a.example.com"));
    assert_eq!(snapshot.api_key, "private-secret-a");
    let selected = select.await.unwrap().unwrap();
    assert_eq!(selected.active_provider_id.as_ref(), Some(&pb.id));
    let snapshot = f.service.request_snapshot().await.unwrap();
    assert!(snapshot.config.base_url.contains("b.example.com"));
    assert_eq!(snapshot.api_key, "private-secret-b");
}
