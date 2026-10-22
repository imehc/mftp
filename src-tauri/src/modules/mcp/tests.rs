use std::collections::BTreeMap;

use rmcp::schemars::{self, JsonSchema};
use serde::{Deserialize, Serialize};
use serde_json::json;

use super::{
    access::{Caller, ModuleGrant, Permission},
    registry::{tool, ModuleRegistration, Registry},
};
use crate::error::{AppError, CustomErrorCode};

#[derive(Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct Echo {
    text: String,
}

fn module(id: &'static str, name: &'static str, permission: Permission) -> ModuleRegistration {
    ModuleRegistration {
        id,
        title: id,
        lifecycle: None,
        tools: vec![tool(
            name,
            "Echo input for isolated registry tests",
            permission,
            |_, input: Echo| async { Ok(input) },
        )
        .unwrap()],
    }
}

fn caller(grant: ModuleGrant) -> Caller {
    Caller::new(
        "test-subject".into(),
        BTreeMap::from([("alpha".into(), grant), ("beta".into(), grant)]),
    )
}

#[tokio::test]
async fn second_module_routes_without_generic_dispatch_changes() {
    let registry = Registry::new(vec![
        module("alpha", "alpha_echo", Permission::Read),
        module("beta", "beta_echo", Permission::Read),
    ])
    .unwrap();
    let caller = caller(ModuleGrant {
        read: true,
        ..Default::default()
    });
    assert_eq!(registry.list(&caller).len(), 2);
    for name in ["alpha_echo", "beta_echo"] {
        let result = registry
            .call(caller.clone(), name, json!({ "text": "模块独立" }))
            .await
            .unwrap();
        assert_eq!(
            result.structured_content,
            Some(json!({ "text": "模块独立" }))
        );
    }
}

#[tokio::test]
async fn global_reader_discovers_registered_modules_and_cannot_dispatch_writes() {
    let registry = Registry::new(vec![
        module("alpha", "alpha_read", Permission::Read),
        module("beta", "beta_write", Permission::Write),
    ])
    .unwrap();
    let caller = Caller::new(
        "global".into(),
        BTreeMap::from([(
            "*".into(),
            ModuleGrant {
                read: true,
                write: false,
                delete: false,
            },
        )]),
    );
    assert_eq!(registry.list(&caller).len(), 1);
    assert!(registry
        .call(caller.clone(), "alpha_read", json!({"text":"global"}))
        .await
        .is_ok());
    assert!(registry
        .call(caller, "beta_write", json!({"text":"denied"}))
        .await
        .is_err());
}

#[test]
fn duplicate_module_tool_and_invalid_names_fail_registration() {
    assert!(Registry::new(vec![
        module("alpha", "alpha_one", Permission::Read),
        module("alpha", "alpha_two", Permission::Read)
    ])
    .is_err());
    let mut duplicate = module("alpha", "alpha_echo", Permission::Read);
    duplicate
        .tools
        .extend(module("alpha", "alpha_echo", Permission::Read).tools);
    assert!(Registry::new(vec![duplicate]).is_err());
    assert!(Registry::new(vec![module("alpha", "beta_echo", Permission::Read)]).is_err());
    assert!(Registry::new(vec![module("alpha", "alpha bad", Permission::Read)]).is_err());
}

#[tokio::test]
async fn catalog_and_dispatch_enforce_same_permissions() {
    let mut registration = module("alpha", "alpha_read", Permission::Read);
    registration
        .tools
        .extend(module("alpha", "alpha_write", Permission::Write).tools);
    registration
        .tools
        .extend(module("alpha", "alpha_delete", Permission::Delete).tools);
    let registry = Registry::new(vec![registration]).unwrap();
    let reader = caller(ModuleGrant {
        read: true,
        ..Default::default()
    });
    assert_eq!(registry.list(&reader).len(), 1);
    assert!(registry
        .call(reader.clone(), "alpha_write", json!({"text":"x"}))
        .await
        .is_err());
    assert!(registry
        .call(reader, "alpha_delete", json!({"text":"x"}))
        .await
        .is_err());
    let writer = caller(ModuleGrant {
        read: true,
        write: true,
        delete: false,
    });
    assert_eq!(registry.list(&writer).len(), 2);
    assert!(registry
        .call(writer, "alpha_delete", json!({"text":"x"}))
        .await
        .is_err());
    let stranger = Caller::new("unknown".into(), BTreeMap::new());
    assert!(registry.list(&stranger).is_empty());
}

#[tokio::test]
async fn malformed_arguments_and_unknown_tools_are_protocol_errors() {
    let registry = Registry::new(vec![module("alpha", "alpha_echo", Permission::Read)]).unwrap();
    let caller = caller(ModuleGrant {
        read: true,
        ..Default::default()
    });
    for arguments in [
        json!({}),
        json!({"text":1}),
        json!({"text":"x","extra":true}),
        json!([]),
    ] {
        assert!(registry
            .call(caller.clone(), "alpha_echo", arguments)
            .await
            .is_err());
    }
    assert!(registry
        .call(caller, "unknown", json!({"text":"x"}))
        .await
        .is_err());
}

#[tokio::test]
async fn business_errors_preserve_structured_app_error() {
    let expected = AppError::custom(CustomErrorCode::TodoNoteConflict).with_arg("id", "isolated");
    let operation_error = expected.clone();
    let registered = tool(
        "alpha_fail",
        "Return a business failure",
        Permission::Read,
        move |_, _: Echo| {
            let error = operation_error.clone();
            async move { Err::<Echo, _>(error) }
        },
    )
    .unwrap();
    let registry = Registry::new(vec![ModuleRegistration {
        id: "alpha",
        title: "Alpha",
        tools: vec![registered],
        lifecycle: None,
    }])
    .unwrap();
    let result = registry
        .call(
            caller(ModuleGrant {
                read: true,
                ..Default::default()
            }),
            "alpha_fail",
            json!({"text":"x"}),
        )
        .await
        .unwrap();
    assert_eq!(result.is_error, Some(true));
    assert_eq!(result.structured_content, Some(json!({"error":expected})));
}

#[test]
fn invalid_input_schema_fails_without_panicking() {
    let result = tool(
        "alpha_bad",
        "Array root is invalid",
        Permission::Read,
        |_, input: Vec<String>| async move { Ok(input) },
    );
    assert!(result.is_err());
}

#[tokio::test]
async fn official_sdk_calls_generic_handler_for_current_and_legacy_revisions() {
    use super::{handler::Handler, runtime::McpRuntime};
    use rmcp::{
        model::{CallToolRequestParams, ClientConfig, ProtocolVersion},
        service::serve_directly,
        RoleClient, RoleServer, ServerHandler,
    };

    for version in [ProtocolVersion::V_2025_11_25, ProtocolVersion::V_2026_07_28] {
        let registry =
            Registry::new(vec![module("alpha", "alpha_echo", Permission::Read)]).unwrap();
        let subject = caller(ModuleGrant {
            read: true,
            ..Default::default()
        });
        let handler = Handler::new(McpRuntime::new(registry), move || Ok(subject.clone()));
        let mut info = handler.get_info();
        info.protocol_version = version.clone();
        let (server_transport, client_transport) = tokio::io::duplex(16 * 1024);
        let mut client_info = ClientConfig::default();
        client_info.protocol_version = version.clone();
        let server =
            serve_directly::<RoleServer, _, _, _, _>(handler, server_transport, Some(client_info));
        let server_task = tokio::spawn(async move { server.waiting().await });
        let client =
            serve_directly::<RoleClient, _, _, _, _>((), client_transport, Some(info.into()));
        let list = client.list_tools(None).await.unwrap();
        assert_eq!(list.tools.len(), 1);
        let result = client
            .call_tool(
                CallToolRequestParams::new("alpha_echo")
                    .with_arguments(json!({"text":"SDK 完整调用"}).as_object().unwrap().clone()),
            )
            .await
            .unwrap();
        assert_eq!(
            result.structured_content,
            Some(json!({"text":"SDK 完整调用"}))
        );
        assert_eq!(
            result.result_type.is_some(),
            version == ProtocolVersion::V_2026_07_28
        );
        client.cancel().await.unwrap();
        server_task.await.unwrap().unwrap();
    }
}

#[tokio::test]
async fn sdk_handler_resolves_permission_changes_for_each_request() {
    use super::{handler::Handler, runtime::McpRuntime};
    use rmcp::{
        model::ClientConfig, service::serve_directly, RoleClient, RoleServer, ServerHandler,
    };
    let access = std::sync::Arc::new(parking_lot::Mutex::new(Some(caller(ModuleGrant {
        read: true,
        ..Default::default()
    }))));
    let resolution = access.clone();
    let registry = Registry::new(vec![module("alpha", "alpha_echo", Permission::Read)]).unwrap();
    let handler = Handler::new(McpRuntime::new(registry), move || {
        resolution
            .lock()
            .clone()
            .ok_or_else(|| AppError::custom(CustomErrorCode::AppShuttingDown))
    });
    let info = handler.get_info();
    let (server_transport, client_transport) = tokio::io::duplex(16 * 1024);
    let server = serve_directly::<RoleServer, _, _, _, _>(
        handler,
        server_transport,
        Some(ClientConfig::default()),
    );
    let server_task = tokio::spawn(async move { server.waiting().await });
    let client = serve_directly::<RoleClient, _, _, _, _>((), client_transport, Some(info.into()));
    assert_eq!(client.list_tools(None).await.unwrap().tools.len(), 1);
    *access.lock() = None;
    assert!(client.list_tools(None).await.is_err());
    client.cancel().await.unwrap();
    server_task.await.unwrap().unwrap();
}
