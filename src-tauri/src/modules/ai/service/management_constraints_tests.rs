use super::*;

#[tokio::test]
async fn provider_duplicates_and_bad_fields_fail_before_secret_io() {
    let f = Fixture::new();
    let a = f.service.create_provider(create(0, "a")).await.unwrap();
    let mut duplicate = create(a.revision, "a");
    duplicate.base_url = "https://A.example.com:443/v1/responses/".into();
    assert_eq!(
        f.service.create_provider(duplicate).await.unwrap_err().code,
        "ai:provider_duplicate"
    );
    for (field, expected) in [
        ("name", "ai:provider_name_invalid"),
        ("label", "ai:key_label_invalid"),
        ("display", "ai:display_name_invalid"),
        ("secret", "ai:api_key_invalid"),
        ("url", "ai:address_invalid"),
        ("model", "ai:model_invalid"),
    ] {
        let mut input = create(a.revision, "b");
        match field {
            "name" => input.name = " ".into(),
            "label" => input.key_label = "x".repeat(81),
            "display" => input.display_name = Some("x".repeat(81)),
            "secret" => input.api_key = " ".into(),
            "url" => input.base_url = "https://user:private-secret@b.example.com".into(),
            "model" => input.model_id = "x".repeat(257),
            _ => unreachable!(),
        }
        let error = f.service.create_provider(input).await.unwrap_err();
        assert_eq!(error.code, expected);
        assert!(!format!("{error:?}").contains("private-secret"));
    }
    assert_eq!(f.service.configuration().await.unwrap(), a);
    assert_eq!(f.credentials.values.lock().len(), 1);
    assert_eq!(f.count("ai_credential_journal"), 0);
}

#[tokio::test]
async fn limits_apply_to_creation_but_allow_editing_existing_rows() {
    let f = Fixture::new();
    let mut v = f.service.create_provider(create(0, "a")).await.unwrap();
    let p = v.providers[0].clone();
    for n in 1..5 {
        v = f
            .service
            .create_provider(create(v.revision, &format!("p{n}")))
            .await
            .unwrap();
    }
    assert_eq!(
        f.service
            .create_provider(create(v.revision, "overflow"))
            .await
            .unwrap_err()
            .code,
        "ai:provider_limit"
    );
    for n in 1..5 {
        v = f
            .service
            .save_key(key_save(
                &v,
                &p.id,
                None,
                &format!("key{n}"),
                Some("private-extra"),
            ))
            .await
            .unwrap();
    }
    assert_eq!(
        f.service
            .save_key(key_save(&v, &p.id, None, "overflow", Some("private-extra")))
            .await
            .unwrap_err()
            .code,
        "ai:key_limit"
    );
    v = f
        .service
        .save_key(key_save(
            &v,
            &p.id,
            Some(p.keys[0].id.clone()),
            "edited",
            None,
        ))
        .await
        .unwrap();
    for n in 1..10 {
        v = f
            .service
            .save_model(model_save(&v, &p.id, &format!("model{n}")))
            .await
            .unwrap();
    }
    assert_eq!(
        f.service
            .save_model(model_save(&v, &p.id, "overflow"))
            .await
            .unwrap_err()
            .code,
        "ai:model_limit"
    );
    let mut edit = model_save(&v, &p.id, "updated");
    edit.id = Some(p.models[0].id.clone());
    v = f.service.save_model(edit).await.unwrap();
    assert_eq!(v.model_candidates.len(), 11);
    assert_eq!(f.count("ai_credential_journal"), 0);
}

#[tokio::test]
async fn key_deletion_checks_last_item_ownership_and_explicit_replacement() {
    let f = Fixture::new();
    let a = f.service.create_provider(create(0, "a")).await.unwrap();
    let p = &a.providers[0];
    let mut delete = AiKeyDeleteInput {
        expected_revision: a.revision,
        provider_id: p.id.clone(),
        key_id: p.keys[0].id.clone(),
        replacement_key_id: None,
    };
    assert_eq!(
        f.service.delete_key(delete.clone()).await.unwrap_err().code,
        "ai:last_key"
    );
    let b = f
        .service
        .create_provider(create(a.revision, "b"))
        .await
        .unwrap();
    let other = b.providers.iter().find(|row| row.name == "b").unwrap().keys[0]
        .id
        .clone();
    let v = f
        .service
        .save_key(key_save(&b, &p.id, None, "second", Some("private-second")))
        .await
        .unwrap();
    delete.expected_revision = v.revision;
    assert_eq!(
        f.service.delete_key(delete.clone()).await.unwrap_err().code,
        "ai:replacement_required"
    );
    delete.replacement_key_id = Some(other);
    assert_eq!(
        f.service.delete_key(delete.clone()).await.unwrap_err().code,
        "ai:key_not_found"
    );
    let second = v
        .providers
        .iter()
        .find(|row| row.id == p.id)
        .unwrap()
        .keys
        .iter()
        .find(|k| k.label == "second")
        .unwrap()
        .id
        .clone();
    delete.replacement_key_id = Some(second.clone());
    let v = f.service.delete_key(delete).await.unwrap();
    assert_eq!(
        v.providers
            .iter()
            .find(|row| row.id == p.id)
            .unwrap()
            .current_key_id,
        Some(second)
    );
    assert_eq!(
        f.service.request_snapshot().await.unwrap().api_key,
        "private-second"
    );
    assert!(!f
        .credentials
        .values
        .lock()
        .values()
        .any(|key| key == "private-secret-a"));
}

#[tokio::test]
async fn model_deletion_checks_last_item_ownership_and_explicit_replacement() {
    let f = Fixture::new();
    let a = f.service.create_provider(create(0, "a")).await.unwrap();
    let p = &a.providers[0];
    let mut delete = AiModelDeleteInput {
        expected_revision: a.revision,
        provider_id: p.id.clone(),
        id: p.models[0].id.clone(),
        replacement_model_id: None,
    };
    assert_eq!(
        f.service
            .delete_model(delete.clone())
            .await
            .unwrap_err()
            .code,
        "ai:last_model"
    );
    let b = f
        .service
        .create_provider(create(a.revision, "b"))
        .await
        .unwrap();
    let other = b
        .providers
        .iter()
        .find(|row| row.name == "b")
        .unwrap()
        .models[0]
        .id
        .clone();
    let v = f
        .service
        .save_model(model_save(&b, &p.id, "second"))
        .await
        .unwrap();
    delete.expected_revision = v.revision;
    assert_eq!(
        f.service
            .delete_model(delete.clone())
            .await
            .unwrap_err()
            .code,
        "ai:replacement_required"
    );
    delete.replacement_model_id = Some(other);
    assert_eq!(
        f.service
            .delete_model(delete.clone())
            .await
            .unwrap_err()
            .code,
        "ai:model_not_found"
    );
    let second = v
        .providers
        .iter()
        .find(|row| row.id == p.id)
        .unwrap()
        .models
        .iter()
        .find(|m| m.model_id == "second")
        .unwrap()
        .id
        .clone();
    delete.replacement_model_id = Some(second.clone());
    let v = f.service.delete_model(delete).await.unwrap();
    assert_eq!(
        v.providers
            .iter()
            .find(|row| row.id == p.id)
            .unwrap()
            .current_model_id,
        Some(second)
    );
    assert_eq!(
        f.service.request_snapshot().await.unwrap().config.model,
        "second"
    );
}

#[tokio::test]
async fn saved_candidates_trim_deduplicate_and_disappear_with_last_reference() {
    let f = Fixture::new();
    let a = f.service.create_provider(create(0, "a")).await.unwrap();
    let p = &a.providers[0];
    assert_eq!(
        f.service
            .save_key(key_save(
                &a,
                &p.id,
                None,
                " personal ",
                Some("private-duplicate")
            ))
            .await
            .unwrap_err()
            .code,
        "ai:key_duplicate"
    );
    assert_eq!(
        f.service
            .save_model(model_save(&a, &p.id, " model-a "))
            .await
            .unwrap_err()
            .code,
        "ai:model_duplicate"
    );
    assert_eq!(
        f.service
            .save_key(key_save(
                &a,
                &p.id,
                Some("wrong-provider-key".into()),
                "new",
                None
            ))
            .await
            .unwrap_err()
            .code,
        "ai:key_not_found"
    );
    let mut model = model_save(&a, &p.id, "updated");
    model.id = Some("wrong-provider-model".into());
    assert_eq!(
        f.service.save_model(model).await.unwrap_err().code,
        "ai:model_not_found"
    );
    let b = f
        .service
        .create_provider(create(a.revision, "b"))
        .await
        .unwrap();
    assert_eq!(b.label_candidates, ["personal"]);
    assert_eq!(b.model_candidates, ["model-a"]);
    let other = b.providers.iter().find(|row| row.name == "b").unwrap();
    let v = f
        .service
        .delete_provider(AiProviderDeleteInput {
            expected_revision: b.revision,
            provider_id: other.id.clone(),
        })
        .await
        .unwrap();
    assert_eq!(v.active_provider_id, a.active_provider_id);
    let v = f
        .service
        .delete_provider(AiProviderDeleteInput {
            expected_revision: v.revision,
            provider_id: p.id.clone(),
        })
        .await
        .unwrap();
    assert!(v.label_candidates.is_empty());
    assert!(v.model_candidates.is_empty());
}

#[tokio::test]
async fn missing_provider_and_revision_overflow_leave_state_unchanged() {
    let f = Fixture::new();
    assert_eq!(
        f.service
            .delete_provider(AiProviderDeleteInput {
                expected_revision: 0,
                provider_id: "missing".into()
            })
            .await
            .unwrap_err()
            .code,
        "ai:provider_not_found"
    );
    for revision in [-1, 9_007_199_254_740_992] {
        assert_eq!(
            f.service
                .create_provider(create(revision, "a"))
                .await
                .unwrap_err()
                .code,
            "ai:revision_conflict"
        );
    }
    f.sql("UPDATE ai_settings SET revision = 9007199254740991;");
    assert_eq!(
        f.service
            .create_provider(create(9_007_199_254_740_991, "a"))
            .await
            .unwrap_err()
            .code,
        "ai:revision_conflict"
    );
    assert!(f.credentials.values.lock().is_empty());
    assert_eq!(f.count("ai_providers"), 0);
}
