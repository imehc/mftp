use super::*;
use crate::error::{AppError, CustomErrorCode};
use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};

#[tauri::command]
fn mutate(calls: tauri::State<'_, Arc<AtomicUsize>>) -> usize {
    calls.fetch_add(1, Ordering::SeqCst) + 1
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
