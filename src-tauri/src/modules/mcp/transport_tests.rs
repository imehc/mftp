use super::{access::ModuleGrant, model::McpCredentialInput, runtime::McpRuntime, server::Server};
use crate::{
    core::{
        activity::{ActivitySink, OperationContext},
        diagnostics::Diagnostics,
        execution::{run_blocking, Executor},
        operations::Operations,
    },
    error::{AppError, AppResult},
    modules::todo::{note_service::TodoNoteService, TodoRepository},
    storage::Storage,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use rmcp::{
    model::{CallToolRequestParams, ClientConfig, ProtocolVersion},
    transport::{
        streamable_http_client::StreamableHttpClientTransportConfig, StreamableHttpClientTransport,
    },
    ServiceExt,
};
use serde_json::{json, Value};
use std::{collections::BTreeMap, io::Cursor, path::PathBuf, sync::Arc, time::Duration};

struct NoLog;
impl ActivitySink for NoLog {
    fn record(&self, _: &OperationContext, _: Option<&AppError>) -> AppResult<()> {
        Ok(())
    }
}

struct Fixture {
    root: PathBuf,
    storage: Storage,
    runtime: Arc<McpRuntime>,
    diagnostics: Arc<Diagnostics>,
}

impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("mftp-mcp-http-{}", uuid::Uuid::new_v4()));
        let storage = Storage::new(root.clone()).unwrap();
        let repository = TodoRepository::new(storage.clone());
        let executor = Executor::new(
            Arc::new(NoLog),
            Arc::new(Operations::with_reset_gate(storage.reset_gate())),
        );
        let runtime = McpRuntime::new(
            crate::app::registry::mcp::build(crate::modules::todo::mcp::TodoContext::new(
                repository.clone(),
                Arc::new(TodoNoteService::new(repository)),
                executor.clone(),
            ))
            .unwrap(),
        );
        let diagnostics = Arc::new(Diagnostics::default());
        runtime
            .attach(storage.clone(), diagnostics.clone(), executor)
            .unwrap();
        Self {
            root,
            storage,
            runtime,
            diagnostics,
        }
    }
    fn server(&self) -> Arc<Server> {
        self.runtime.server().unwrap().clone()
    }
    fn input(write: bool, delete: bool) -> McpCredentialInput {
        McpCredentialInput {
            name: "隔离测试".into(),
            grants: BTreeMap::from([(
                "todo".into(),
                ModuleGrant {
                    read: true,
                    write,
                    delete,
                },
            )]),
        }
    }
    fn token(&self, write: bool, delete: bool) -> super::model::McpIssuedCredential {
        let mut input = Self::input(write, delete);
        let grant = input.grants.remove("todo").unwrap();
        input
            .grants
            .insert(super::access::ALL_MODULES.into(), grant);
        self.server().issue(input).unwrap()
    }
    async fn start(&self) -> String {
        let reserved = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = reserved.local_addr().unwrap().port();
        drop(reserved);
        self.server().configure(port).unwrap();
        self.server().start().await.unwrap();
        self.server().snapshot().unwrap().endpoint.unwrap()
    }
    async fn stop(&self) {
        let server = self.server();
        tokio::time::timeout(
            Duration::from_secs(5),
            run_blocking(move || {
                server.stop_blocking();
                Ok(())
            }),
        )
        .await
        .unwrap()
        .unwrap();
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.server().stop_blocking();
        self.runtime.shutdown();
        std::fs::remove_dir_all(&self.root).unwrap();
    }
}

async fn serialized(operation: impl std::future::Future<Output = ()> + Send + 'static) {
    tokio::task::spawn_blocking(move || {
        let _serial = crate::modules::todo::note_tests::TEST_LOCK.lock();
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(operation);
    })
    .await
    .unwrap();
}

fn image() -> String {
    let image = image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
        12,
        8,
        image::Rgba([20, 0, 0, 128]),
    ));
    let mut bytes = Cursor::new(Vec::new());
    image.write_to(&mut bytes, image::ImageFormat::Png).unwrap();
    STANDARD.encode(bytes.into_inner())
}

#[tokio::test]
async fn global_authorization_validation_preserves_explicit_permissions_and_legacy_scope() {
    serialized(async {
        let fixture = Fixture::new();
        let issued = fixture.token(true, false);
        assert_eq!(issued.credential.grants.len(), 1);
        assert!(issued.credential.grants[super::access::ALL_MODULES].write);
        assert!(!issued.credential.grants[super::access::ALL_MODULES].delete);
        let mut mixed = Fixture::input(false, false);
        mixed.grants.insert(
            super::access::ALL_MODULES.into(),
            ModuleGrant {
                read: true,
                write: false,
                delete: false,
            },
        );
        assert!(fixture.server().issue(mixed).is_err());
        let mut invalid = issued.credential.grants.clone();
        invalid.get_mut(super::access::ALL_MODULES).unwrap().read = false;
        assert!(fixture
            .server()
            .issue(McpCredentialInput {
                name: "invalid".into(),
                grants: invalid
            })
            .is_err());
        let mut invalid = issued.credential.grants.clone();
        invalid.get_mut(super::access::ALL_MODULES).unwrap().write = false;
        invalid.get_mut(super::access::ALL_MODULES).unwrap().delete = true;
        assert!(fixture
            .server()
            .issue(McpCredentialInput {
                name: "invalid".into(),
                grants: invalid
            })
            .is_err());
        let legacy = fixture
            .server()
            .issue(Fixture::input(false, false))
            .unwrap();
        assert!(!legacy
            .credential
            .grants
            .contains_key(super::access::ALL_MODULES));
        assert_eq!(fixture.server().snapshot().unwrap().credentials.len(), 2);
    })
    .await;
}

#[tokio::test]
async fn official_http_client_round_trips_full_image_text_and_recovers_save_receipt() {
    serialized(async {
        let fixture=Fixture::new();
        let issued=fixture.token(true,false);
        let endpoint=fixture.start().await;
        let http=reqwest::Client::builder().no_proxy().build().unwrap();
        let transport=StreamableHttpClientTransport::with_client(http,StreamableHttpClientTransportConfig::with_uri(endpoint).auth_header(issued.token.clone()));
        let client=ClientConfig::default().serve(transport).await.unwrap();
        let tools=client.list_tools(None).await.unwrap();
        assert_eq!(tools.tools.len(),15);
        assert!(!tools.tools.iter().any(|tool|tool.name=="todo_delete"));
        let invoke=|name:&'static str,arguments:Value| CallToolRequestParams::new(name).with_arguments(arguments.as_object().unwrap().clone());
        let draft=client.call_tool(invoke("todo_note_draft_begin",json!({}))).await.unwrap().structured_content.unwrap()["draft"]["id"].as_str().unwrap().to_owned();
        let uploaded=client.call_tool(invoke("todo_note_image_import",json!({"draftId":draft,"dataBase64":image(),"mimeType":"image/png"}))).await.unwrap();
        assert_eq!(uploaded.is_error,Some(false));
        let asset=uploaded.structured_content.unwrap()["image"]["id"].as_str().unwrap().to_owned();
        let document=json!({"version":2,"blocks":[{"type":"paragraph","content":[{"type":"text","text":"前文"},{"type":"image","assetId":asset},{"type":"text","text":"后文"}]}]});
        let saved=client.call_tool(invoke("todo_note_save",json!({"draftId":draft,"metadata":{"title":"完整图文","completed":false},"document":document}))).await.unwrap();
        assert_eq!(saved.is_error,Some(false),"{saved:?}");
        let saved=saved.structured_content.unwrap();
        let id=saved["item"]["id"].as_str().unwrap();
        let status=client.call_tool(invoke("todo_note_save_status",json!({"draftId":draft}))).await.unwrap().structured_content.unwrap();
        assert_eq!(status["state"],"saved");
        assert_eq!(status["itemId"],id);
        let read=client.call_tool(invoke("todo_get",json!({"id":id}))).await.unwrap().structured_content.unwrap();
        assert_eq!(read["document"],document);
        let read_image=client.call_tool(invoke("todo_note_image_read",json!({"itemId":id,"assetId":asset}))).await.unwrap();
        assert!(!read_image.content.is_empty());
        let failure=client.call_tool(invoke("todo_update",json!({"id":id,"revision":-1,"title":"冲突"}))).await.unwrap();
        assert_eq!(failure.is_error,Some(true));
        client.cancel().await.unwrap();
        fixture.stop().await;
        let snapshot=serde_json::to_string(&fixture.diagnostics.snapshot(0)).unwrap();
        assert!(snapshot.contains("todo_note_image_import"));
        assert!(snapshot.contains("前文"));
        assert!(snapshot.contains("httpRequest") && snapshot.contains("httpResponse"));
        assert!(snapshot.contains("todo:note_conflict"));
        assert!(!snapshot.contains(&issued.token));
        assert!(!fixture.server().is_busy());
    }).await;
}

#[tokio::test]
async fn http_security_rejects_origin_host_query_credentials_and_oversized_bodies() {
    serialized(async {
        let fixture = Fixture::new();
        let token = fixture.token(false, false).token;
        let endpoint = fixture.start().await;
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let body = r#"{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}"#;
        assert_eq!(
            client
                .post(&endpoint)
                .body(body)
                .send()
                .await
                .unwrap()
                .status(),
            401
        );
        assert_eq!(
            client
                .post(&endpoint)
                .bearer_auth(&token)
                .header("Origin", "http://evil.example")
                .send()
                .await
                .unwrap()
                .status(),
            403
        );
        assert_eq!(
            client
                .post(&endpoint)
                .bearer_auth(&token)
                .header("Host", "evil.example")
                .send()
                .await
                .unwrap()
                .status(),
            403
        );
        assert_eq!(
            client
                .post(format!("{endpoint}?token={token}"))
                .send()
                .await
                .unwrap()
                .status(),
            404
        );
        let oversized = client
            .post(&endpoint)
            .bearer_auth(&token)
            .header("content-type", "application/json")
            .header("accept", "application/json, text/event-stream")
            .body(" ".repeat(27_200_000))
            .send()
            .await
            .unwrap();
        assert_eq!(oversized.status(), 413);
        drop(oversized);
        fixture.stop().await;
        let snapshot = serde_json::to_string(&fixture.diagnostics.snapshot(0)).unwrap();
        assert!(!snapshot.contains(&token));
        assert!(snapshot.contains("truncated\":true"));
    })
    .await;
}

#[tokio::test]
async fn permission_changes_rotation_and_restart_never_reuse_old_authorization() {
    serialized(async {
        let fixture = Fixture::new();
        let issued = fixture.token(true, false);
        let endpoint = fixture.start().await;
        let old = fixture
            .server()
            .authenticate(&super::repository::digest(&issued.token))
            .unwrap();
        let draft = fixture
            .runtime
            .registry
            .call(old.clone(), "todo_note_draft_begin", json!({}))
            .await
            .unwrap()
            .structured_content
            .unwrap()["draft"]["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let server = fixture.server();
        let id = issued.credential.id.clone();
        run_blocking(move || server.update(&id, Fixture::input(false, false)))
            .await
            .unwrap();
        assert!(old.cancelled());
        assert_eq!(
            fixture
                .storage
                .conn()
                .unwrap()
                .query_row(
                    "SELECT COUNT(*) FROM todo_note_drafts WHERE id=?1",
                    [draft],
                    |row| row.get::<_, u32>(0)
                )
                .unwrap(),
            0
        );
        let fresh = fixture
            .server()
            .authenticate(&super::repository::digest(&issued.token))
            .unwrap();
        assert!(!fresh.allows("todo", super::access::Permission::Write));
        let server = fixture.server();
        let id = issued.credential.id.clone();
        let rotated = run_blocking(move || server.rotate(&id, Fixture::input(true, false)))
            .await
            .unwrap();
        assert!(fixture
            .server()
            .authenticate(&super::repository::digest(&issued.token))
            .is_err());
        let http = reqwest::Client::builder().no_proxy().build().unwrap();
        assert_eq!(
            http.post(&endpoint)
                .bearer_auth(&issued.token)
                .send()
                .await
                .unwrap()
                .status(),
            401
        );
        fixture.stop().await;
        fixture.server().start().await.unwrap();
        let fresh = fixture
            .server()
            .authenticate(&super::repository::digest(&rotated.token))
            .unwrap();
        let reopened = fixture
            .runtime
            .registry
            .call(fresh, "todo_note_draft_begin", json!({}))
            .await
            .unwrap();
        assert_eq!(reopened.is_error, Some(false));
        fixture.stop().await;
    })
    .await;
}

#[test]
fn migration_reset_import_and_export_keep_credentials_digest_only_and_local() {
    let fixture = Fixture::new();
    let issued = fixture.token(true, false);
    let reopened = Storage::new(fixture.root.clone()).unwrap();
    assert_eq!(
        super::repository::Repository(reopened)
            .list()
            .unwrap()
            .len(),
        1
    );
    let digest: String = fixture
        .storage
        .conn()
        .unwrap()
        .query_row("SELECT digest FROM mcp_credentials", [], |row| row.get(0))
        .unwrap();
    assert_eq!(digest, super::repository::digest(&issued.token));
    assert_ne!(digest, issued.token);
    let exported = fixture
        .storage
        .export_document(&[crate::models::ExportSection::Todo], None)
        .unwrap();
    assert!(!exported.contains(&digest) && !exported.contains(&issued.token));
    fixture
        .storage
        .import_document(&exported, None, crate::models::ImportMode::Append)
        .unwrap();
    assert!(fixture.server().snapshot().unwrap().credentials.is_empty());
    fixture.token(false, false);
    fixture.storage.reset_database().unwrap();
    assert!(fixture.server().snapshot().unwrap().credentials.is_empty());
    Storage::new(fixture.root.clone()).unwrap();
    assert_eq!(fixture.server().snapshot().unwrap().port, 6021);
}

#[tokio::test]
async fn legacy_http_initialization_and_tools_work_without_persistent_sessions() {
    serialized(async {
        let fixture = Fixture::new();
        let issued = fixture.token(false, false);
        let endpoint = fixture.start().await;
        let transport = StreamableHttpClientTransport::with_client(
            reqwest::Client::builder().no_proxy().build().unwrap(),
            StreamableHttpClientTransportConfig::with_uri(endpoint).auth_header(issued.token),
        );
        let mut info = ClientConfig::default();
        info.protocol_version = ProtocolVersion::V_2025_11_25;
        let client = info.serve(transport).await.unwrap();
        assert_eq!(client.list_tools(None).await.unwrap().tools.len(), 3);
        client.cancel().await.unwrap();
        fixture.stop().await;
    })
    .await;
}
