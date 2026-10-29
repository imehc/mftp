use super::*;

#[test]
fn moved_document_handlers_preserve_ipc_names_and_arguments() {
    use tauri::test::{get_ipc_response, INVOKE_KEY};
    let fixture = Fixture::new();
    let webview = tauri::WebviewWindowBuilder::new(&fixture.app, "main", Default::default())
        .build()
        .unwrap();
    for (cmd, body) in [
        (
            "data_import",
            json!({"raw": document(), "password": null, "mode": "merge"}),
        ),
        (
            "data_export",
            json!({"sections": ["todo"], "password": null}),
        ),
        ("data_inspect", json!({"raw": document()})),
    ] {
        let result = get_ipc_response(
            &webview,
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
        .unwrap()
        .deserialize::<Value>()
        .unwrap();
        match cmd {
            "data_import" => assert_eq!(result["sections"][0]["inserted"], 1),
            "data_export" => {
                let doc: Value = serde_json::from_str(result.as_str().unwrap()).unwrap();
                assert_eq!(doc["sections"]["todo"][0]["title"], "private task");
            }
            _ => assert_eq!(result, json!({"encrypted": false, "sections": ["todo"]})),
        }
    }
    assert_eq!(
        fixture
            .storage
            .list_activity_logs(10, None, None)
            .unwrap()
            .len(),
        2
    );
}

#[test]
fn moved_room_handlers_keep_ipc_arguments_and_error_payloads() {
    use tauri::test::{get_ipc_response, INVOKE_KEY};
    let fixture = Fixture::new();
    let webview = tauri::WebviewWindowBuilder::new(&fixture.app, "main", Default::default())
        .build()
        .unwrap();
    let invoke = |cmd: &str, body: Value| {
        get_ipc_response(
            &webview,
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
    };
    assert_eq!(
        invoke("game_room_status", json!({}))
            .unwrap()
            .deserialize::<Value>()
            .unwrap(),
        json!({
            "phase": "idle", "instanceId": null, "roomId": null, "gameId": null, "roomName": null,
            "host": null, "port": null, "seat": null, "playerName": null,
            "peerName": null, "hasCode": false, "code": null,
        })
    );
    fixture.operations.close();
    for (cmd, body) in [
        ("game_room_status", json!({})),
        (
            "game_room_create",
            json!({"gameId": "gomoku", "roomName": "room", "code": "private", "playerName": "host"}),
        ),
        (
            "game_room_join",
            json!({"host": "127.0.0.1", "port": 27183, "gameId": "gomoku", "code": null, "playerName": "guest"}),
        ),
        ("game_room_discover", json!({"gameId": "gomoku"})),
        (
            "game_room_send",
            json!({"instanceId": "instance", "payload": "opaque"}),
        ),
        ("game_room_leave", json!({"instanceId": "instance"})),
    ] {
        let error: AppError = serde_json::from_value(invoke(cmd, body).unwrap_err()).unwrap();
        assert_eq!(
            error,
            AppError::custom(crate::error::CustomErrorCode::AppShuttingDown),
            "{cmd}"
        );
    }
    assert!(fixture
        .storage
        .list_activity_logs(10, None, None)
        .unwrap()
        .is_empty());
}
