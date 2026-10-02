use super::*;
use std::collections::BTreeSet;
use std::path::Path;
use std::sync::Mutex;
use tauri_specta::{BuilderConfiguration, LanguageExt};

mod common_only {
    use super::super::*;
    // Exercise the exact iOS expansion on the host, without loading BT commands.
    common_modules! {}
}

#[test]
fn common_platform_catalog_excludes_bt_but_keeps_every_common_command() {
    let expected: Vec<_> = include_str!("command_baseline.txt")
        .lines()
        .filter_map(|line| line.strip_prefix("common "))
        .collect();
    assert!(!common_only::module_commands()
        .iter()
        .any(|(module, _)| *module == "bt"));
    let captured = Mutex::new(None);
    common_only::specta_builder()
        .export(Capture(&captured), Path::new("unused"))
        .unwrap();
    let config = captured.into_inner().unwrap().unwrap();
    assert_eq!(
        config
            .commands
            .iter()
            .map(|command| command.name().as_ref())
            .collect::<Vec<_>>(),
        expected
    );
}

struct Capture<'a>(&'a Mutex<Option<BuilderConfiguration>>);
impl LanguageExt for Capture<'_> {
    type Error = std::io::Error;
    fn export(self, config: &BuilderConfiguration, _: &Path) -> Result<(), Self::Error> {
        *self.0.lock().unwrap() = Some(config.clone());
        Ok(())
    }
}

#[test]
fn registered_commands_match_platform_baseline_without_duplicates() {
    let actual: Vec<_> = module_commands()
        .into_iter()
        .flat_map(|(_, commands)| commands)
        .map(|path| path.rsplit("::").next().unwrap().trim())
        .collect();
    let expected: Vec<_> = include_str!("command_baseline.txt")
        .lines()
        .filter(|line| !line.starts_with('#'))
        .filter_map(|line| {
            let (platform, name) = line.split_once(' ')?;
            (platform == "common" || cfg!(any(desktop, target_os = "android"))).then_some(name)
        })
        .collect();
    assert_eq!(actual, expected);
    assert_eq!(actual.len(), actual.iter().collect::<BTreeSet<_>>().len());
    let captured = Mutex::new(None);
    specta_builder()
        .export(Capture(&captured), Path::new("unused"))
        .unwrap();
    let config = captured.into_inner().unwrap().unwrap();
    assert_eq!(
        config
            .commands
            .iter()
            .map(|command| command.name().as_ref())
            .collect::<Vec<_>>(),
        expected
    );
}

#[test]
fn event_only_types_are_still_exported() {
    let output = std::env::temp_dir().join(format!("mftp-registry-{}.ts", uuid::Uuid::new_v4()));
    specta_builder()
        .export(specta_typescript::Typescript::default(), &output)
        .unwrap();
    let bindings = std::fs::read_to_string(&output).unwrap();
    std::fs::remove_file(output).unwrap();
    for retired in [
        "aiConnectionGet:",
        "aiConnectionSave:",
        "aiConnectionClearKey:",
        "aiConnectionTest:",
        "export type AiConnection =",
        "export type AiConnectionInput =",
    ] {
        assert!(!bindings.contains(retired), "retired IPC: {retired}");
    }
    for name in [
        "CustomErrorCode",
        "AiProviderTargetInput",
        "AiProviderSelectionInput",
        "AiModelSwitchInput",
        "AiStreamingUpdateInput",
        "AiConfigurationView",
        "AiProviderCreateInput",
        "AiKeySaveInput",
        "AiKeyState",
        "TransferProgress",
        "PoetrySyncProgress",
        "PoetryTranslationStreamEvent",
        "GameRoomPeerEvent",
        "GameRoomClosedEvent",
        "GameRoomMessageEvent",
        "GameRoomClosedReason",
    ] {
        assert!(
            bindings.contains(&format!("export type {name} =")),
            "{name}"
        );
    }
    assert_eq!(
        bindings.contains("export type BtTaskEvent ="),
        cfg!(any(desktop, target_os = "android"))
    );
    for name in [
        "aiProviderActivate",
        "aiProviderSelect",
        "aiModelSwitch",
        "aiStreamingUpdate",
        "aiProviderTest",
        "aiConfigurationGet",
        "aiProviderCreate",
        "aiProviderUpdate",
        "aiProviderDelete",
        "aiKeySave",
        "aiKeyDelete",
        "aiModelSave",
        "aiModelDelete",
        "todoItemCreate",
        "todoItemUpdate",
        "todoItemDelete",
        "sftpMkdir",
        "sshConnect",
    ] {
        assert!(bindings.contains(&format!("{name}:")), "{name}");
    }
}

#[test]
#[cfg(desktop)]
fn grouped_catalog_preserves_the_handler_and_argument_extraction() {
    use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
    #[tauri::command]
    #[specta::specta]
    fn add_one(input: i32) -> crate::error::AppResult<i32> {
        Ok(input + 1)
    }
    #[tauri::command]
    #[specta::specta]
    fn echo(input: String) -> crate::error::AppResult<String> {
        Ok(input)
    }

    // The production flattening pattern must deliver both groups in one handler.
    let builder = Builder::<tauri::test::MockRuntime>::new()
        .commands(collect_module_commands![[add_one], [echo]]);
    let app = mock_builder()
        .invoke_handler(builder.invoke_handler())
        .build(mock_context(noop_assets()))
        .unwrap();
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    for (cmd, input, expected) in [
        ("add_one", serde_json::json!(41), serde_json::json!(42)),
        (
            "echo",
            serde_json::json!("preserved"),
            serde_json::json!("preserved"),
        ),
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
                body: tauri::ipc::InvokeBody::Json(serde_json::json!({ "input": input })),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.into(),
            },
        )
        .unwrap()
        .deserialize::<serde_json::Value>()
        .unwrap();
        assert_eq!(result, expected);
    }
}
