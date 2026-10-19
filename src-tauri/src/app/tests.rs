use super::*;
use crate::error::{AppError, CustomErrorCode};
use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};

#[tauri::command]
fn mutate(calls: tauri::State<'_, Arc<AtomicUsize>>) -> usize {
    calls.fetch_add(1, Ordering::SeqCst) + 1
}

#[tauri::command]
fn app_data_reset_status() -> bool {
    true
}

#[test]
fn reset_gate_allows_only_recovery_ipc_and_still_respects_maintenance_and_shutdown() {
    let pending = Arc::new(std::sync::atomic::AtomicBool::new(true));
    let operations = Arc::new(crate::core::operations::Operations::with_reset_gate(
        pending,
    ));
    let lifecycle = Arc::new(lifecycle::Lifecycle::new(operations.clone()));
    let calls = Arc::new(AtomicUsize::new(0));
    let app = mock_builder()
        .manage(lifecycle.clone())
        .manage(calls.clone())
        .invoke_handler(guard_commands(tauri::generate_handler![
            mutate,
            app_data_reset_status
        ]))
        .build(mock_context(noop_assets()))
        .unwrap();
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let invoke = |command: &str| {
        get_ipc_response(
            &webview,
            tauri::webview::InvokeRequest {
                cmd: command.into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: if cfg!(windows) {
                    "http://tauri.localhost"
                } else {
                    "tauri://localhost"
                }
                .parse()
                .unwrap(),
                body: Default::default(),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.into(),
            },
        )
    };
    assert_eq!(
        serde_json::from_value::<AppError>(invoke("mutate").unwrap_err())
            .unwrap()
            .code,
        "app:reset_pending"
    );
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    assert!(invoke("app_data_reset_status")
        .unwrap()
        .deserialize::<bool>()
        .unwrap());
    tauri::async_runtime::block_on(async {
        let lease = operations
            .recovery_maintenance(Duration::from_secs(1))
            .await
            .unwrap();
        assert_eq!(
            serde_json::from_value::<AppError>(invoke("app_data_reset_status").unwrap_err())
                .unwrap()
                .code,
            "app:maintenance_in_progress"
        );
        drop(lease);
        lifecycle.begin_shutdown();
    });
    assert_eq!(
        serde_json::from_value::<AppError>(invoke("app_data_reset_status").unwrap_err())
            .unwrap()
            .code,
        "app:shutting_down"
    );
}

#[test]
fn maintenance_and_shutdown_gates_reject_ipc_before_dispatching_the_command() {
    let operations = Arc::new(crate::core::operations::Operations::default());
    let lifecycle = Arc::new(lifecycle::Lifecycle::new(operations.clone()));
    let calls = Arc::new(AtomicUsize::new(0));
    let app = mock_builder()
        .manage(lifecycle.clone())
        .manage(calls.clone())
        .invoke_handler(guard_commands(tauri::generate_handler![mutate]))
        .build(mock_context(noop_assets()))
        .unwrap();
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let request = || tauri::webview::InvokeRequest {
        cmd: "mutate".into(),
        callback: tauri::ipc::CallbackFn(0),
        error: tauri::ipc::CallbackFn(1),
        url: if cfg!(windows) {
            "http://tauri.localhost"
        } else {
            "tauri://localhost"
        }
        .parse()
        .unwrap(),
        body: Default::default(),
        headers: Default::default(),
        invoke_key: INVOKE_KEY.into(),
    };
    assert_eq!(
        get_ipc_response(&webview, request())
            .unwrap()
            .deserialize::<usize>()
            .unwrap(),
        1
    );
    tauri::async_runtime::block_on(async {
        let worker = operations.begin().unwrap();
        let mut pending = Box::pin(operations.maintenance(Duration::from_secs(2)));
        assert!(futures_util::poll!(&mut pending).is_pending());
        let value = get_ipc_response(&webview, request()).unwrap_err();
        assert_eq!(
            serde_json::from_value::<AppError>(value).unwrap(),
            AppError::custom(CustomErrorCode::AppMaintenanceInProgress)
        );
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        drop(worker);
        let maintenance = pending.await.unwrap();
        assert!(get_ipc_response(&webview, request()).is_err());
        drop(maintenance);
        assert_eq!(
            get_ipc_response(&webview, request())
                .unwrap()
                .deserialize::<usize>()
                .unwrap(),
            2
        );
        let maintenance = operations
            .maintenance(Duration::from_secs(2))
            .await
            .unwrap();
        lifecycle.begin_shutdown();
        drop(maintenance);
    });
    let value = get_ipc_response(&webview, request()).unwrap_err();
    assert_eq!(
        serde_json::from_value::<AppError>(value).unwrap(),
        AppError::custom(CustomErrorCode::AppShuttingDown)
    );
    assert_eq!(calls.load(Ordering::SeqCst), 2);
}

#[test]
fn export_cleanup_can_drain_while_new_operations_are_rejected() {
    let operations = Arc::new(crate::core::operations::Operations::default());
    let lifecycle = Arc::new(lifecycle::Lifecycle::new(operations.clone()));
    let app = mock_builder()
        .manage(lifecycle.clone())
        .invoke_handler(guard_commands(|invoke| {
            invoke.resolver.resolve(true);
            true
        }))
        .build(mock_context(noop_assets()))
        .unwrap();
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let request = |cmd: &str| tauri::webview::InvokeRequest {
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
        body: Default::default(),
        headers: Default::default(),
        invoke_key: INVOKE_KEY.into(),
    };
    tauri::async_runtime::block_on(async {
        let lease = operations
            .maintenance(Duration::from_secs(1))
            .await
            .unwrap();
        for cmd in [
            "model_export_cancel",
            "model_export_close",
            "model_environment_abort",
            "speech_stop",
        ] {
            assert_eq!(
                get_ipc_response(&webview, request(cmd)).is_ok(),
                !cmd.starts_with("model_export_") || cfg!(mobile)
            );
        }
        for cmd in [
            "model_export_begin",
            "model_export_write",
            "model_export_present",
            "model_environment_begin",
            "model_environment_clear",
            "speech_start",
            "speech_control",
        ] {
            assert!(get_ipc_response(&webview, request(cmd)).is_err());
        }
        drop(lease);
    });
    lifecycle.begin_shutdown();
    assert_eq!(
        get_ipc_response(&webview, request("model_export_close")).is_ok(),
        cfg!(mobile)
    );
    assert!(get_ipc_response(&webview, request("model_environment_abort")).is_ok());
    assert!(get_ipc_response(&webview, request("model_export_present")).is_err());
}
