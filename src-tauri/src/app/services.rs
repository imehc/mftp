use std::sync::Arc;
use tauri::Manager as _;

use super::lifecycle::Lifecycle;
use crate::adapters::{activity_log::StorageActivityLog, ai::AiKeychain, room_events};
use crate::core::{execution::Executor, operations::Operations};
use crate::error::AppResult;
use crate::modules::game_room::GameRoomManager;
use crate::modules::hosts::HostRepository;
use crate::modules::keys::KeyRepository;
use crate::modules::lan_transfer::{repository::LanRepository, LanTransferManager};
use crate::modules::maintenance::participants;
use crate::modules::todo::TodoRepository;
use crate::modules::vault::VaultRepository;
use crate::modules::{
    ai::{AiConfigurationService, AiRepository, AiTaskManager},
    poetry::sync::PoetryLibrary,
    ssh::Manager,
};
use crate::storage::Storage;

/// The single shared service state injected via Tauri `State`.
pub struct AppServices {
    pub(crate) model_viewer: Arc<crate::modules::model_viewer::ModelViewerService>,
    pub(crate) model_library: crate::modules::model_viewer::ModelLibraryRepository,
    pub storage: Storage,
    pub ai_tasks: Arc<AiTaskManager>,
    pub(crate) ai_configuration: Arc<AiConfigurationService<AiKeychain>>,
    #[cfg(target_os = "android")]
    pub(crate) ai_credentials: Arc<AiKeychain>,
    pub manager: Arc<Manager>,
    pub lan_transfer: Arc<LanTransferManager>,
    pub(crate) lan_repository: LanRepository,
    pub(crate) host_repository: HostRepository,
    pub(crate) key_repository: KeyRepository,
    pub(crate) vault_repository: VaultRepository,
    pub(crate) todo_repository: TodoRepository,
    pub game_room: Arc<GameRoomManager>,
    pub poetry: Arc<PoetryLibrary>,
    #[cfg(any(desktop, target_os = "android"))]
    pub bt: Arc<crate::modules::bt::BtManager>,
    pub(crate) executor: Executor,
    pub(crate) lifecycle: Arc<Lifecycle>,
}

pub(super) fn install(app: &tauri::AppHandle) -> AppResult<AppServices> {
    let data_dir = app.path().app_data_dir()?;
    let storage = Storage::new(data_dir.clone())?;
    let operations = Arc::new(Operations::default());
    let mut lifecycle = Lifecycle::new(operations.clone());
    // Stop-registration names share the maintenance participant ids, and the
    // busy capability registered here is the single source both the shutdown
    // report and the maintenance admission list query.
    let manager = lifecycle.install(
        participants::SSH,
        Arc::new(Manager::new(data_dir.join("transfer-temp-files.json"))),
        Manager::shutdown_all,
        |manager: &Manager| Ok(manager.is_busy()),
    );
    let lan_transfer = lifecycle.install(
        participants::LAN_TRANSFER,
        Arc::new(LanTransferManager::new(operations.clone())),
        LanTransferManager::shutdown,
        |service: &LanTransferManager| Ok(service.status().running),
    );
    let game_room = lifecycle.install(
        participants::GAME_ROOM,
        room_events::install(app, operations.clone()),
        GameRoomManager::shutdown,
        |service: &GameRoomManager| Ok(service.status().phase != "idle"),
    );
    #[cfg(any(desktop, target_os = "android"))]
    let bt = lifecycle.install(
        participants::BT,
        crate::adapters::bt::install(app, storage.clone()),
        crate::adapters::bt::shutdown,
        |bt: &crate::modules::bt::BtManager| bt.has_active_work(),
    );
    // Poetry workers hold their own operation leases until the real thread
    // exits (see sync::spawn_job); the stop callback only requests a
    // cooperative cancel. AI generations lease through the AiTaskGuard.
    let poetry = lifecycle.install(
        participants::POETRY,
        Arc::new(PoetryLibrary::new(data_dir, operations.clone())),
        PoetryLibrary::cancel_sync,
        |library: &PoetryLibrary| Ok(library.is_active()),
    );
    let executor = Executor::new(
        Arc::new(StorageActivityLog(storage.clone())),
        operations.clone(),
    );
    let ai_credentials = Arc::new(AiKeychain::install(app));
    let ai_configuration = AiConfigurationService::new(
        AiRepository::new(storage.clone()),
        ai_credentials.clone(),
        executor.clone(),
        operations.clone(),
    );
    let recovery = ai_configuration.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = recovery.recover().await {
            eprintln!("AI credential recovery pending: {}", error.code);
        }
    });
    let services = AppServices {
        model_viewer: Arc::new(crate::modules::model_viewer::ModelViewerService::default()),
        model_library: crate::modules::model_viewer::ModelLibraryRepository::new(storage.clone()),
        executor,
        ai_configuration,
        #[cfg(target_os = "android")]
        ai_credentials,
        lan_repository: LanRepository::new(storage.clone()),
        host_repository: HostRepository::new(storage.clone()),
        key_repository: KeyRepository::new(storage.clone()),
        vault_repository: VaultRepository::new(storage.clone()),
        todo_repository: TodoRepository::new(storage.clone()),
        storage,
        manager,
        lan_transfer,
        game_room,
        poetry,
        ai_tasks: Arc::new(AiTaskManager::new(operations)),
        #[cfg(any(desktop, target_os = "android"))]
        bt,
        lifecycle: Arc::new(lifecycle),
    };
    // LAN's mobile UI is not exposed; auto-start must not open mobile sockets.
    #[cfg(desktop)]
    start_lan_if_configured(&services);
    Ok(services)
}

#[cfg(desktop)]
fn start_lan_if_configured(services: &AppServices) {
    let start = || -> AppResult<()> {
        let settings = services.lan_repository.settings()?;
        if !settings.auto_start {
            return Ok(());
        }
        let shares = services.lan_repository.shared_dirs()?;
        let trusted_ips = services
            .lan_repository
            .trusted_devices()?
            .into_iter()
            .map(|device| device.ip)
            .collect();
        services.lan_transfer.start(
            settings,
            shares,
            trusted_ips,
            services.storage.db_path().to_path_buf(),
        )?;
        Ok(())
    };
    if let Err(error) = start() {
        eprintln!("failed to auto start LAN transfer: {error}");
    }
}
