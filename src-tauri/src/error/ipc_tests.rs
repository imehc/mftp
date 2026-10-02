use super::*;
use serde_json::json;
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};

#[tauri::command]
#[specta::specta]
fn error_probe(custom: bool) -> AppResult<()> {
    Err(if custom {
        AppError::custom(CustomErrorCode::BtFileNotInTask).with_arg("path", "目录/文件.txt")
    } else {
        std::io::Error::from(std::io::ErrorKind::NotFound).into()
    })
}

#[test]
fn ipc_rejection_preserves_the_same_flat_contract() {
    let builder = tauri_specta::Builder::<tauri::test::MockRuntime>::new()
        .commands(tauri_specta::collect_commands![error_probe]);
    let app = mock_builder()
        .invoke_handler(builder.invoke_handler())
        .build(mock_context(noop_assets()))
        .unwrap();
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    for custom in [true, false] {
        let error = get_ipc_response(
            &webview,
            tauri::webview::InvokeRequest {
                cmd: "error_probe".into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: if cfg!(windows) {
                    "http://tauri.localhost"
                } else {
                    "tauri://localhost"
                }
                .parse()
                .unwrap(),
                body: tauri::ipc::InvokeBody::Json(json!({ "custom": custom })),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.into(),
            },
        )
        .unwrap_err();
        assert_eq!(
            error.as_object().map(|object| object.len()),
            Some(4),
            "{error}"
        );
        let restored: AppError = serde_json::from_value(error).unwrap();
        assert_eq!(restored, error_probe(custom).unwrap_err());
    }
}
