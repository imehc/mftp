use super::lifecycle::Lifecycle;
use crate::adapters::{activity_log::StorageActivityLog, ai::AiKeychain};
use crate::core::activity::OperationContext;
use crate::core::{activity::ActivitySink, execution::Executor, operations::Operations};
use crate::error::AppError;
use crate::models::{ExportSection, ImportMode};
use crate::modules::ai::AiTaskManager;
use crate::modules::bt::{ports::FileAccess, repository::BtRepository, BtManager};
use crate::modules::game_room::GameRoomManager;
use crate::modules::lan_transfer::{repository::LanRepository, LanTransferManager};
use crate::modules::maintenance::export::{data_export, data_import, data_inspect};
use crate::modules::todo::{note_service::TodoNoteService, TodoRepository};
use crate::modules::{poetry::sync::PoetryLibrary, ssh::Manager as SshManager};
use crate::storage::Storage;
use crate::{app::services::AppServices, error::AppResult};
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc};
use std::time::Duration;
use tauri::{test::MockRuntime, Manager, State};

#[path = "maintenance_reset_tests.rs"]
mod reset_tests;
#[path = "maintenance_usage_tests.rs"]
mod usage_tests;

struct UnusedFiles;
impl FileAccess for UnusedFiles {
    fn download_dir(&self) -> AppResult<PathBuf> {
        unreachable!("document commands do not open system files")
    }
    fn open(&self, _: &Path) -> AppResult<()> {
        unreachable!("document commands do not open system files")
    }
}

struct Fixture {
    app: tauri::App<MockRuntime>,
    storage: Storage,
    operations: Arc<Operations>,
    root: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        Self::with_sink(|storage| Arc::new(StorageActivityLog(storage)))
    }

    fn with_sink(factory: impl FnOnce(Storage) -> Arc<dyn ActivitySink>) -> Self {
        let root =
            std::env::temp_dir().join(format!("maintenance-export-{}", uuid::Uuid::new_v4()));
        let storage = Storage::new(root.clone()).unwrap();
        let operations = Arc::new(Operations::with_reset_gate(storage.reset_gate()));
        // Construct idle services without native keychain calls, sockets or engines.
        let executor = Executor::new(factory(storage.clone()), operations.clone());
        let todo_repository = TodoRepository::new(storage.clone());
        let todo_notes = Arc::new(TodoNoteService::new(todo_repository.clone()));
        let mut lifecycle = Lifecycle::new(operations.clone());
        let mcp = lifecycle.install(
            crate::modules::maintenance::participants::MCP,
            crate::modules::mcp::runtime::McpRuntime::new(
                crate::app::registry::mcp::build(crate::modules::todo::mcp::TodoContext::new(
                    todo_repository.clone(),
                    todo_notes.clone(),
                    executor.clone(),
                ))
                .unwrap(),
            ),
            crate::modules::mcp::runtime::McpRuntime::shutdown,
            crate::modules::mcp::runtime::McpRuntime::busy,
        );
        mcp.attach(
            storage.clone(),
            Arc::new(crate::core::diagnostics::Diagnostics::default()),
            executor.clone(),
        )
        .unwrap();
        let state = AppServices {
            translation: Arc::new(crate::modules::translation::TranslationService::new(
                root.join("translation-models"),
                operations.clone(),
            )),
            diagnostics: Arc::new(crate::core::diagnostics::Diagnostics::default()),
            model_inbox: Arc::new(crate::modules::model_viewer::system::ModelOpenInbox::default()),
            model_viewer: Arc::new(crate::modules::model_viewer::ModelViewerService::default()),
            model_library: crate::modules::model_viewer::ModelLibraryRepository::new(
                storage.clone(),
            ),
            storage: storage.clone(),
            ai_tasks: Arc::new(AiTaskManager::new(operations.clone())),
            ai_configuration: crate::modules::ai::AiConfigurationService::new(
                crate::modules::ai::AiRepository::new(storage.clone()),
                Arc::new(AiKeychain::in_memory()),
                executor.clone(),
                operations.clone(),
            ),
            manager: Arc::new(SshManager::new(root.join("transfer-temp-files.json"))),
            lan_transfer: Arc::new(LanTransferManager::new(operations.clone())),
            lan_repository: LanRepository::new(storage.clone()),
            host_repository: crate::modules::hosts::HostRepository::new(storage.clone()),
            key_repository: crate::modules::keys::KeyRepository::new(storage.clone()),
            vault_repository: crate::modules::vault::VaultRepository::new(storage.clone()),
            todo_repository,
            todo_notes,
            mcp,
            game_room: Arc::new(GameRoomManager::new(
                Arc::new(|_, _| {}),
                operations.clone(),
            )),
            speech: Arc::new(crate::modules::speech::SpeechService::default()),
            poetry: Arc::new(PoetryLibrary::new(root.clone(), operations.clone())),
            bt: Arc::new(BtManager::new(
                BtRepository::new(storage.clone()),
                root.join("bt"),
                Arc::new(|_| {}),
                Arc::new(UnusedFiles),
            )),
            executor,
            lifecycle: Arc::new(lifecycle),
        };
        let app = tauri::test::mock_builder()
            .manage(state)
            .invoke_handler(tauri::generate_handler![
                crate::modules::diagnostics::diagnostics_snapshot,
                crate::modules::diagnostics::diagnostics_clear,
                crate::modules::ai::configuration::commands::ai_configuration_get,
                crate::modules::ai::configuration::commands::ai_provider_create,
                crate::modules::ai::configuration::commands::ai_provider_update,
                crate::modules::ai::configuration::commands::ai_provider_delete,
                crate::modules::ai::configuration::commands::ai_key_save,
                crate::modules::ai::configuration::commands::ai_key_delete,
                crate::modules::ai::configuration::commands::ai_model_save,
                crate::modules::ai::configuration::commands::ai_model_delete,
                crate::modules::ai::configuration::commands::ai_provider_activate,
                crate::modules::ai::configuration::commands::ai_provider_select,
                crate::modules::ai::configuration::commands::ai_model_switch,
                crate::modules::ai::configuration::commands::ai_streaming_update,
                crate::modules::ai::configuration::commands::ai_provider_test,
                crate::modules::ai::configuration::commands::ai_provider_test_streaming,
                crate::modules::maintenance::export::data_export,
                crate::modules::maintenance::export::data_inspect,
                crate::modules::maintenance::export::data_import,
                crate::modules::game_room::commands::game_room_status,
                crate::modules::game_room::commands::game_room_create,
                crate::modules::game_room::commands::game_room_join,
                crate::modules::game_room::commands::game_room_discover,
                crate::modules::game_room::commands::game_room_send,
                crate::modules::game_room::commands::game_room_leave
            ])
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        Self {
            app,
            storage,
            operations,
            root,
        }
    }

    fn state(&self) -> State<'_, AppServices> {
        self.app.state()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.state().game_room.shutdown();
        // Failed assertions must not delete a database still owned by a worker.
        if self.operations.wait_idle(Duration::from_secs(6)) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }
}

#[tokio::test]
async fn room_commands_preserve_errors_and_logs_and_reject_maintenance_before_dispatch() {
    use crate::modules::game_room::commands::{
        game_room_create, game_room_discover, game_room_join, game_room_leave, game_room_send,
        game_room_status,
    };
    let fixture = Fixture::new();
    let maintenance = fixture.state().executor.maintenance().await.unwrap();
    for expected in ["app:maintenance_in_progress", "app:shutting_down"] {
        if expected == "app:shutting_down" {
            fixture.state().lifecycle.begin_shutdown();
        }
        let errors = [
            game_room_status(fixture.state()).await.unwrap_err(),
            game_room_create(
                fixture.state(),
                "game".into(),
                "room".into(),
                None,
                "host".into(),
            )
            .await
            .unwrap_err(),
            game_room_join(
                fixture.state(),
                "invalid".into(),
                1,
                "game".into(),
                None,
                "guest".into(),
            )
            .await
            .unwrap_err(),
            game_room_discover(fixture.state(), "game".into())
                .await
                .unwrap_err(),
            game_room_send(fixture.state(), "instance".into(), "payload".into())
                .await
                .unwrap_err(),
            game_room_leave(fixture.state(), "instance".into())
                .await
                .unwrap_err(),
        ];
        for error in errors {
            assert_eq!(error.code, expected);
        }
    }
    drop(maintenance);
    assert!(fixture
        .storage
        .list_activity_logs(10, None, None)
        .unwrap()
        .is_empty());
    assert_eq!(fixture.state().game_room.status().phase, "idle");

    let fixture = Fixture::new();
    let secret = "private-room-code";
    let error = game_room_join(
        fixture.state(),
        "invalid".into(),
        1,
        "game".into(),
        Some(secret.into()),
        "guest".into(),
    )
    .await
    .unwrap_err();
    assert_eq!(
        error,
        AppError::custom(crate::error::CustomErrorCode::RoomAddressInvalid)
    );
    assert_eq!(
        game_room_send(fixture.state(), "instance".into(), secret.into())
            .await
            .unwrap_err()
            .code,
        "room:not_joined"
    );
    assert_eq!(
        game_room_status(fixture.state()).await.unwrap().phase,
        "idle"
    );
    game_room_leave(fixture.state(), "instance".into())
        .await
        .unwrap();
    let logs = fixture.storage.list_activity_logs(10, None, None).unwrap();
    assert_eq!(logs.len(), 2);
    assert!(logs.iter().all(|log| log.source == "games"));
    assert!(logs
        .iter()
        .any(|log| log.request_type == "join_room" && log.result == "failed"));
    assert!(logs
        .iter()
        .any(|log| log.request_type == "leave_room" && log.result == "success"));
    assert!(logs
        .iter()
        .all(|log| !log.detail.as_deref().unwrap_or_default().contains(secret)));
}

fn document() -> String {
    json!({
        "app": "mftp", "format": 1,
        "sections": { "todo": [{
            "id": "todo-1", "title": "private task", "category": null,
            "notes": "private notes", "dueDate": null, "completed": false,
            "createdAt": 1, "updatedAt": 1
        }] }
    })
    .to_string()
}

#[tokio::test]
async fn document_commands_reject_maintenance_and_shutdown_before_work_or_logs() {
    let fixture = Fixture::new();
    let maintenance = fixture.state().executor.maintenance().await.unwrap();
    for expected in ["app:maintenance_in_progress", "app:shutting_down"] {
        if expected == "app:shutting_down" {
            assert!(fixture.state().lifecycle.begin_shutdown());
        }
        let errors = [
            data_export(fixture.state(), vec![ExportSection::Todo], None)
                .await
                .unwrap_err(),
            data_inspect(fixture.state(), "invalid".into())
                .await
                .unwrap_err(),
            data_import(fixture.state(), document(), None, ImportMode::Overwrite)
                .await
                .unwrap_err(),
        ];
        for error in errors {
            assert_eq!(error.kind, crate::error::AppErrorKind::Custom);
            assert_eq!(error.code, expected);
        }
    }
    drop(maintenance);
    assert!(TodoRepository::new(fixture.storage.clone())
        .list()
        .unwrap()
        .is_empty());
    assert!(fixture
        .storage
        .list_activity_logs(10, None, None)
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn encrypted_command_round_trip_preserves_modes_and_log_metadata() {
    let source = Fixture::new();
    data_import(source.state(), document(), None, ImportMode::Merge)
        .await
        .unwrap();
    let password = "private export password";
    let raw = data_export(
        source.state(),
        vec![ExportSection::Todo],
        Some(password.into()),
    )
    .await
    .unwrap();
    assert!(!raw.contains("private task"));
    let preview = data_inspect(source.state(), raw.clone()).await.unwrap();
    assert!(preview.encrypted);
    assert!(preview.sections.is_empty());

    let target = Fixture::new();
    for (mode, inserted, updated, total) in [
        (ImportMode::Merge, 1, 0, 1),
        (ImportMode::Merge, 0, 1, 1),
        (ImportMode::Append, 1, 0, 2),
        (ImportMode::Overwrite, 1, 0, 1),
    ] {
        let report = data_import(target.state(), raw.clone(), Some(password.into()), mode)
            .await
            .unwrap();
        assert_eq!(report.sections.len(), 1);
        assert_eq!(report.sections[0].section, ExportSection::Todo);
        assert_eq!(report.sections[0].inserted, inserted);
        assert_eq!(report.sections[0].updated, updated);
        assert_eq!(
            TodoRepository::new(target.storage.clone())
                .list()
                .unwrap()
                .len(),
            total
        );
    }
    let expected = target
        .storage
        .import_document(&raw, Some("wrong"), ImportMode::Overwrite)
        .unwrap_err();
    assert_eq!(
        data_import(
            target.state(),
            raw,
            Some("wrong".into()),
            ImportMode::Overwrite
        )
        .await
        .unwrap_err(),
        expected
    );
    assert_eq!(
        TodoRepository::new(target.storage.clone())
            .list()
            .unwrap()
            .len(),
        1
    );
    let source_logs = source.storage.list_activity_logs(10, None, None).unwrap();
    assert_eq!(source_logs.len(), 2);
    for log in source_logs {
        assert_eq!(log.source, "data");
        assert!(log.ip.is_empty());
        assert!(log.detail.is_none());
        assert_eq!(log.result, "success");
    }
    let target_logs = target.storage.list_activity_logs(10, None, None).unwrap();
    assert_eq!(target_logs.len(), 5);
    assert_eq!(
        target_logs
            .iter()
            .filter(|log| log.result == "failed")
            .count(),
        1
    );
    assert!(target_logs.iter().all(|log| log.request_type == "import"));
}

#[tokio::test]
async fn canceled_import_waiter_keeps_admission_until_database_and_log_finish() {
    let fixture = Fixture::new();
    let mut connection = rusqlite::Connection::open(fixture.storage.db_path()).unwrap();
    let lock = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .unwrap();
    let mut command = Box::pin(data_import(
        fixture.state(),
        document(),
        None,
        ImportMode::Overwrite,
    ));
    assert!(futures_util::poll!(&mut command).is_pending());
    drop(command);
    assert!(!fixture.operations.wait_idle(Duration::ZERO));
    let state = fixture.state();
    let mut maintenance = Box::pin(state.executor.maintenance());
    assert!(futures_util::poll!(&mut maintenance).is_pending());
    lock.commit().unwrap();
    let lease = tokio::time::timeout(Duration::from_secs(3), maintenance)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        TodoRepository::new(fixture.storage.clone())
            .list()
            .unwrap()
            .len(),
        1
    );
    let logs = fixture.storage.list_activity_logs(10, None, None).unwrap();
    assert_eq!(logs.len(), 1);
    assert_eq!(logs[0].request_type, "import");
    assert_eq!(logs[0].result, "success");
    drop(lease);
}

struct PausedLog {
    storage: Storage,
    started: Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
    release: Mutex<mpsc::Receiver<()>>,
}

impl ActivitySink for PausedLog {
    fn record(&self, context: &OperationContext, error: Option<&AppError>) -> AppResult<()> {
        self.started.lock().take().unwrap().send(()).unwrap();
        self.release
            .lock()
            .recv_timeout(Duration::from_secs(3))
            .unwrap();
        StorageActivityLog(self.storage.clone()).record(context, error)
    }
}

#[tokio::test]
async fn canceled_export_waiter_retains_final_log_during_shutdown() {
    let (started, ready) = tokio::sync::oneshot::channel();
    let (release, finish) = mpsc::channel();
    let fixture = Fixture::with_sink(|storage| {
        Arc::new(PausedLog {
            storage,
            started: Mutex::new(Some(started)),
            release: Mutex::new(finish),
        })
    });
    let mut command = Box::pin(data_export(
        fixture.state(),
        vec![ExportSection::Todo],
        None,
    ));
    assert!(futures_util::poll!(&mut command).is_pending());
    ready.await.unwrap();
    drop(command);
    let lifecycle = fixture.state().lifecycle.clone();
    assert!(lifecycle.begin_shutdown());
    assert!(!lifecycle.shutdown_blocking(Duration::ZERO).completed());
    release.send(()).unwrap();
    let report = crate::core::execution::run_blocking(move || {
        Ok(lifecycle.shutdown_blocking(Duration::from_secs(3)))
    })
    .await
    .unwrap();
    assert!(report.completed());
    let logs = fixture.storage.list_activity_logs(10, None, None).unwrap();
    assert_eq!(logs.len(), 1);
    assert_eq!(logs[0].request_type, "export");
    assert_eq!(logs[0].result, "success");
}

#[path = "ai_management_ipc_tests.rs"]
mod ai_management;
#[path = "maintenance_ipc_tests.rs"]
mod ipc_tests;
