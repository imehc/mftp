use super::*;
use crate::modules::ai::{AiConnectionConfig, AiRepository};
use tauri::test::{get_ipc_response, INVOKE_KEY};

fn invoke(
    webview: &tauri::WebviewWindow<MockRuntime>,
    cmd: &str,
    body: Value,
) -> Result<Value, Value> {
    get_ipc_response(
        webview,
        tauri::webview::InvokeRequest {
            cmd: cmd.into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: if cfg!(windows) {
                "http://tauri.localhost"
            } else {
                "tauri://localhost"
            }
            .parse()
            .unwrap(),
            body: tauri::ipc::InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.into(),
        },
    )
    .map(|response| response.deserialize::<Value>().unwrap())
}

#[test]
fn management_handlers_preserve_arguments_public_metadata_and_errors() {
    let f = Fixture::new();
    let webview = tauri::WebviewWindowBuilder::new(&f.app, "main", Default::default())
        .build()
        .unwrap();
    let empty = invoke(&webview, "ai_configuration_get", json!({})).unwrap();
    assert_eq!(empty["providers"], json!([]));
    let error = invoke(&webview, "ai_provider_create", json!({"input": {
        "expectedRevision": 0, "name": "a", "baseUrl": "https://a.example.com", "keyLabel": "personal", "apiKey": " ", "modelId": "model-a"
    }})).unwrap_err();
    assert_eq!(error["code"], "ai:api_key_invalid");
    // Populate a missing credential slot without touching a native keychain.
    AiRepository::new(f.storage.clone())
        .save_connection(&AiConnectionConfig {
            base_url: "https://a.example.com".into(),
            model: "model-a".into(),
            streaming_enabled: true,
        })
        .unwrap();
    let view = invoke(&webview, "ai_configuration_get", json!({})).unwrap();
    let id = view["providers"][0]["id"].clone();
    let key = view["providers"][0]["keys"][0]["id"].clone();
    let model = view["providers"][0]["models"][0]["id"].clone();
    let view = invoke(&webview, "ai_provider_update", json!({"input": {"expectedRevision": view["revision"], "providerId": id, "name": "Renamed", "baseUrl": "https://a.example.com/v1"}})).unwrap();
    let view = invoke(&webview, "ai_key_save", json!({"input": {"expectedRevision": view["revision"], "providerId": id, "keyId": key, "label": "personal", "replacementSecret": null}})).unwrap();
    assert_eq!(view["providers"][0]["keys"][0]["state"], "missing");
    let view = invoke(&webview, "ai_model_save", json!({"input": {"expectedRevision": view["revision"], "providerId": id, "id": null, "modelId": "model-b", "displayName": "Second"}})).unwrap();
    let replacement = view["providers"][0]["models"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["modelId"] == "model-b")
        .unwrap()["id"]
        .clone();
    let view = invoke(&webview, "ai_model_delete", json!({"input": {"expectedRevision": view["revision"], "providerId": id, "id": model, "replacementModelId": replacement}})).unwrap();
    let error = invoke(&webview, "ai_key_delete", json!({"input": {"expectedRevision": view["revision"], "providerId": id, "keyId": key, "replacementKeyId": null}})).unwrap_err();
    assert_eq!(error["kind"], "custom");
    assert_eq!(error["code"], "ai:last_key");
    assert!(error["args"].is_object());
    assert!(error["message"].is_string());
    let view = invoke(
        &webview,
        "ai_provider_delete",
        json!({"input": {"expectedRevision": view["revision"], "providerId": id}}),
    )
    .unwrap();
    assert_eq!(view["providers"], json!([]));
    assert!(view["activeProviderId"].is_null());
}

#[test]
fn management_handlers_reject_maintenance_before_credentials_and_redact_bad_input() {
    let f = Fixture::new();
    let webview = tauri::WebviewWindowBuilder::new(&f.app, "main", Default::default())
        .build()
        .unwrap();
    let lease = tauri::async_runtime::block_on(f.state().executor.maintenance()).unwrap();
    let cases = [
        ("ai_configuration_get", json!({})),
        (
            "ai_provider_create",
            json!({"input": {"expectedRevision": 0, "name": "a", "baseUrl": "https://a.example.com", "keyLabel": "personal", "apiKey": "private-secret", "modelId": "model-a"}}),
        ),
        (
            "ai_provider_update",
            json!({"input": {"expectedRevision": 0, "providerId": "a", "name": "a", "baseUrl": "https://a.example.com"}}),
        ),
        (
            "ai_provider_delete",
            json!({"input": {"expectedRevision": 0, "providerId": "a"}}),
        ),
        (
            "ai_key_save",
            json!({"input": {"expectedRevision": 0, "providerId": "a", "label": "personal", "replacementSecret": "private-secret"}}),
        ),
        (
            "ai_key_delete",
            json!({"input": {"expectedRevision": 0, "providerId": "a", "keyId": "k"}}),
        ),
        (
            "ai_model_save",
            json!({"input": {"expectedRevision": 0, "providerId": "a", "modelId": "a"}}),
        ),
        (
            "ai_model_delete",
            json!({"input": {"expectedRevision": 0, "providerId": "a", "id": "m"}}),
        ),
    ];
    for (cmd, body) in cases {
        let error = invoke(&webview, cmd, body).unwrap_err();
        assert_eq!(error["code"], "app:maintenance_in_progress", "{cmd}");
        assert!(!error.to_string().contains("private-secret"));
    }
    drop(lease);
    let error = invoke(&webview, "ai_key_save", json!({"input": {"expectedRevision": 0, "providerId": "a", "label": "personal", "replacementSecret": ["private-secret"]}})).unwrap_err();
    assert!(!error.to_string().contains("private-secret"));
    assert!(f
        .storage
        .list_activity_logs(20, None, None)
        .unwrap()
        .is_empty());
}

#[path = "ai_selection_ipc_tests.rs"]
mod selection;
