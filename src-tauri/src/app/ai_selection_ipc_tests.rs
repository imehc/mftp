use super::*;

#[test]
fn provider_test_records_into_the_shared_panel_and_links_one_activity_result() {
    let f = Fixture::new();
    let main = tauri::WebviewWindowBuilder::new(&f.app, "main", Default::default())
        .build()
        .unwrap();
    let _ = invoke(
        &main,
        "ai_provider_test",
        json!({"input":{"expectedRevision":0,"providerId":"missing"}}),
    )
    .unwrap_err();
    let snapshot = invoke(&main, "diagnostics_snapshot", json!({"after":0})).unwrap();
    let record = &snapshot["operations"][0];
    assert_eq!(record["status"], "failed");
    assert_eq!(record["details"], json!([]));
    let logs = f.storage.list_activity_logs(10, Some("ai"), None).unwrap();
    assert_eq!(logs.len(), 1);
    assert_eq!(logs[0].operation_id.as_deref(), record["id"].as_str());
    // The panel is shared, not owned per webview: another window sees the same
    // records, and only an explicit clear discards them.
    let other = tauri::WebviewWindowBuilder::new(&f.app, "other", Default::default())
        .build()
        .unwrap();
    let seen = invoke(&other, "diagnostics_snapshot", json!({"after":0})).unwrap();
    assert_eq!(seen["operations"][0]["id"], record["id"]);
    invoke(&other, "diagnostics_clear", json!({})).unwrap();
    assert_eq!(
        invoke(&main, "diagnostics_snapshot", json!({"after":0})).unwrap()["operations"],
        json!([])
    );
}

#[test]
fn selection_handlers_restore_saved_rows_and_keep_test_read_only() {
    let f = Fixture::new();
    let repo = AiRepository::new(f.storage.clone());
    for name in ["a", "b"] {
        repo.save_connection(&AiConnectionConfig {
            protocol: Default::default(),
            base_url: format!("https://{name}.example.com"),
            model: format!("model-{name}"),
            streaming_enabled: true,
        })
        .unwrap();
    }
    // Metadata-only commands must not retrieve these synthetic references.
    f.storage
        .conn()
        .unwrap()
        .execute(
            "UPDATE ai_provider_keys SET credential_ref = 'ai-' || id",
            [],
        )
        .unwrap();
    let webview = tauri::WebviewWindowBuilder::new(&f.app, "main", Default::default())
        .build()
        .unwrap();
    let v = invoke(&webview, "ai_configuration_get", json!({})).unwrap();
    let a = v["providers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["baseUrl"] == "https://a.example.com")
        .unwrap();
    let id = a["id"].clone();
    let key = a["keys"][0]["id"].clone();
    let model = a["models"][0]["id"].clone();
    let v = invoke(
        &webview,
        "ai_provider_activate",
        json!({"input":{"expectedRevision":v["revision"],"providerId":id}}),
    )
    .unwrap();
    assert_eq!(v["activeProviderId"], id);
    let v = invoke(&webview, "ai_provider_select", json!({"input":{"expectedRevision":v["revision"],"providerId":id,"currentKeyId":key,"currentModelId":model}})).unwrap();
    let v = invoke(&webview, "ai_model_switch", json!({"input":{"expectedRevision":v["revision"],"expectedActiveProviderId":id,"modelId":model}})).unwrap();
    let v = invoke(
        &webview,
        "ai_streaming_update",
        json!({"input":{"expectedRevision":v["revision"],"streamingEnabled":false}}),
    )
    .unwrap();
    assert_eq!(v["streamingEnabled"], false);
    let error = invoke(&webview, "ai_model_switch", json!({"input":{"expectedRevision":v["revision"],"expectedActiveProviderId":"other","modelId":model}})).unwrap_err();
    assert_eq!(error["code"], "ai:active_provider_changed");
    let error = invoke(
        &webview,
        "ai_provider_test",
        json!({"input":{"expectedRevision":0,"providerId":id}}),
    )
    .unwrap_err();
    assert_eq!(error["code"], "ai:revision_conflict");
    assert_eq!(
        invoke(&webview, "ai_configuration_get", json!({})).unwrap(),
        v
    );
    f.storage
        .conn()
        .unwrap()
        .execute("UPDATE ai_provider_keys SET credential_ref = NULL", [])
        .unwrap();
    let error = invoke(
        &webview,
        "ai_provider_test",
        json!({"input":{"expectedRevision":v["revision"],"providerId":id}}),
    )
    .unwrap_err();
    assert_eq!(error["code"], "ai:api_key_missing");
    assert_eq!(error["kind"], "custom");
    assert!(error["args"].is_object());
}

#[test]
fn selection_and_test_handlers_reject_maintenance_without_native_io() {
    let f = Fixture::new();
    let webview = tauri::WebviewWindowBuilder::new(&f.app, "main", Default::default())
        .build()
        .unwrap();
    let _lease = tauri::async_runtime::block_on(f.state().executor.maintenance()).unwrap();
    for (cmd, input) in [
        (
            "ai_provider_activate",
            json!({"expectedRevision":0,"providerId":"a"}),
        ),
        (
            "ai_provider_select",
            json!({"expectedRevision":0,"providerId":"a","currentKeyId":"k","currentModelId":"m"}),
        ),
        (
            "ai_model_switch",
            json!({"expectedRevision":0,"expectedActiveProviderId":"a","modelId":"m"}),
        ),
        (
            "ai_streaming_update",
            json!({"expectedRevision":0,"streamingEnabled":false}),
        ),
        (
            "ai_provider_test",
            json!({"expectedRevision":0,"providerId":"a"}),
        ),
        (
            "ai_provider_test_streaming",
            json!({"expectedRevision":0,"providerId":"a"}),
        ),
    ] {
        let error = invoke(&webview, cmd, json!({"input":input})).unwrap_err();
        assert_eq!(error["code"], "app:maintenance_in_progress", "{cmd}");
    }
    assert!(f
        .storage
        .list_activity_logs(20, None, None)
        .unwrap()
        .is_empty());
}
