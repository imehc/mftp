use crate::app::services::AppServices;
use crate::core::activity::OperationContext;
use crate::core::execution::run_blocking;
use crate::error::{AppError, AppResult, CustomErrorCode};
use crate::modules::hosts::model::{AuthType, Host, HostInput};
use crate::modules::keys::KeyRepository;
use crate::modules::ssh::{auth_method, test_connection, SshConnectionTest, SystemStats};
use crate::modules::ssh::{resolve_auth_material, AuthMaterial};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use tauri::{AppHandle, State};

/// 连接目标与认证来源。已存主机连接与未保存主机测试共用，
/// 避免逐个传递主机与凭据字段形成超长参数列表。
struct ConnectionRequest {
    host: String,
    port: u16,
    username: String,
    auth_type: AuthType,
    password: Option<String>,
    key_id: Option<String>,
    passphrase: Option<String>,
}

impl From<&Host> for ConnectionRequest {
    fn from(host: &Host) -> Self {
        Self {
            host: host.host.clone(),
            port: host.port,
            username: host.username.clone(),
            auth_type: host.auth_type.clone(),
            password: host.password.clone(),
            key_id: host.key_id.clone(),
            passphrase: None,
        }
    }
}

impl From<&HostInput> for ConnectionRequest {
    fn from(input: &HostInput) -> Self {
        Self {
            host: input.host.trim().to_string(),
            port: input.port,
            username: input.username.trim().to_string(),
            auth_type: input.auth_type.clone(),
            password: input.password.clone(),
            key_id: input.key_id.clone(),
            passphrase: None,
        }
    }
}

impl ConnectionRequest {
    /// Passphrase 由前端按次会话传入，不属于主机记录或表单，单独补足。
    fn with_passphrase(mut self, passphrase: Option<String>) -> Self {
        self.passphrase = passphrase;
        self
    }
}

fn build_auth(
    key_repository: &KeyRepository,
    request: &ConnectionRequest,
) -> AppResult<AuthMaterial> {
    let method = auth_method(
        &request.auth_type,
        request.password.as_deref(),
        request.key_id.as_deref(),
        |id| key_repository.private_key(id),
        request.passphrase.clone(),
    )?;
    resolve_auth_material(AuthMaterial {
        host: request.host.clone(),
        port: request.port,
        username: request.username.clone(),
        method,
        identity_files: Vec::new(),
    })
}

#[tauri::command]
#[specta::specta]
pub async fn ssh_connect(
    state: State<'_, AppServices>,
    host_id: String,
    passphrase: Option<String>,
) -> AppResult<String> {
    // Resolve the host first (a plain DB read) so its hostname/label can become
    // safe log metadata; the SSH session registration runs under admission.
    let host = {
        let repository = state.host_repository.clone();
        run_blocking(move || repository.get(&host_id)).await?
    };
    let context =
        OperationContext::new("ssh", "connect", host.host.clone()).with_detail(host.label.clone());
    let key_repository = state.key_repository.clone();
    let manager = state.manager.clone();
    super::blocking(&state, context, None, move || {
        let request = ConnectionRequest::from(&host).with_passphrase(passphrase);
        let mat = build_auth(&key_repository, &request)?;
        let session_id = uuid::Uuid::new_v4().to_string();
        manager.register(&session_id, mat);
        Ok(session_id)
    })
    .await
}

/// Test an unsaved host configuration without touching stored data or session
/// state. Resolution, authentication and the SFTP check all run on the shared
/// blocking pipeline so the form gets the same failures a real connection would.
#[tauri::command]
#[specta::specta]
pub async fn ssh_test_connection(
    state: State<'_, AppServices>,
    input: HostInput,
    passphrase: Option<String>,
) -> AppResult<SshConnectionTest> {
    let context = OperationContext::new(
        "ssh",
        "test_connection",
        format!("{}:{}", input.host.trim(), input.port),
    )
    .with_detail(input.label.trim().to_string());
    let key_repository = state.key_repository.clone();
    super::blocking(&state, context, None, move || {
        let request = ConnectionRequest::from(&input).with_passphrase(passphrase);
        let mat = build_auth(&key_repository, &request)?;
        test_connection(&mat)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn ssh_open_shell(
    app: AppHandle,
    state: State<'_, AppServices>,
    session_id: String,
    cols: u32,
    rows: u32,
) -> AppResult<()> {
    let events = crate::adapters::ssh::event_sink(&app);
    let manager = state.manager.clone();
    let log_session = session_id.clone();
    let context = OperationContext::new("ssh", "open_shell", log_session);
    super::blocking(&state, context, None, move || {
        manager.open_shell(events, &session_id, cols, rows)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub fn ssh_write(state: State<AppServices>, session_id: String, data: String) -> AppResult<()> {
    let _operation = state.manager.operation()?;
    let bytes = STANDARD
        .decode(data.as_bytes())
        .map_err(|_| AppError::custom(CustomErrorCode::SshInvalidWritePayload))?;
    state.manager.write(&session_id, &bytes)
}

#[tauri::command]
#[specta::specta]
pub fn ssh_resize(
    state: State<AppServices>,
    session_id: String,
    cols: u32,
    rows: u32,
) -> AppResult<()> {
    let _operation = state.manager.operation()?;
    state.manager.resize(&session_id, cols, rows)
}

#[tauri::command]
#[specta::specta]
pub async fn ssh_disconnect(state: State<'_, AppServices>, session_id: String) -> AppResult<()> {
    let manager = state.manager.clone();
    let log_session = session_id.clone();
    let context = OperationContext::new("ssh", "disconnect", log_session);
    super::blocking(&state, context, None, move || {
        manager.disconnect(&session_id);
        Ok(())
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn ssh_system_stats(
    state: State<'_, AppServices>,
    session_id: String,
) -> AppResult<SystemStats> {
    let manager = state.manager.clone();
    super::reading(&state, &session_id.clone(), "ssh_system_stats", move || {
        manager.system_stats(&session_id)
    })
    .await
}
