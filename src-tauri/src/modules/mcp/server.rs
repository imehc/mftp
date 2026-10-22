use parking_lot::{Condvar, Mutex};
use std::{
    collections::{BTreeMap, BTreeSet},
    future::IntoFuture,
    sync::{Arc, Weak},
    time::Duration,
};
use tokio_util::sync::CancellationToken;

use super::{
    access::{Authorization, Caller, ALL_MODULES},
    model::{McpCredentialInput, McpIssuedCredential, McpSnapshot},
    repository::{invalid, Repository},
    runtime::McpRuntime,
    transport,
};
use crate::{
    core::{
        diagnostics::Diagnostics,
        execution::{run_blocking, Executor},
    },
    error::{AppError, AppResult, CustomErrorCode},
    storage::Storage,
};

#[derive(Default)]
struct State {
    task: Option<Task>,
    authorizations: BTreeMap<String, Arc<Authorization>>,
    retiring: BTreeSet<String>,
}

struct Task {
    cancel: CancellationToken,
    port: u16,
    done: Arc<Completion>,
}

#[derive(Default)]
struct Completion {
    done: Mutex<bool>,
    changed: Condvar,
}

struct Finished(Arc<Completion>);

impl Drop for Finished {
    fn drop(&mut self) {
        *self.0.done.lock() = true;
        self.0.changed.notify_all();
    }
}

pub(crate) struct Server {
    runtime: Weak<McpRuntime>,
    repository: Repository,
    state: Mutex<State>,
    pub(crate) diagnostics: Arc<Diagnostics>,
    pub(crate) executor: Executor,
}

impl Server {
    pub(crate) fn new(
        runtime: Weak<McpRuntime>,
        storage: Storage,
        diagnostics: Arc<Diagnostics>,
        executor: Executor,
    ) -> Arc<Self> {
        Arc::new(Self {
            runtime,
            repository: Repository(storage),
            state: Mutex::new(State::default()),
            diagnostics,
            executor,
        })
    }

    pub(crate) fn runtime(&self) -> AppResult<Arc<McpRuntime>> {
        self.runtime.upgrade().ok_or_else(invalid)
    }

    pub(crate) fn is_busy(&self) -> bool {
        self.state
            .lock()
            .task
            .as_ref()
            .is_some_and(|task| !*task.done.done.lock())
    }

    pub(crate) fn while_stopped<T>(
        &self,
        operation: impl FnOnce() -> AppResult<T>,
    ) -> AppResult<T> {
        let state = self.state.lock();
        if state
            .task
            .as_ref()
            .is_some_and(|task| !*task.done.done.lock())
        {
            return Err(crate::modules::maintenance::participants::busy_error(
                crate::modules::maintenance::participants::MCP,
            ));
        }
        operation()
    }

    pub(crate) fn snapshot(&self) -> AppResult<McpSnapshot> {
        let state = self.state.lock();
        let task = state.task.as_ref().filter(|task| !*task.done.done.lock());
        Ok(McpSnapshot {
            running: task.is_some_and(|task| !task.cancel.is_cancelled()),
            stopping: task.is_some_and(|task| task.cancel.is_cancelled()),
            port: task
                .map(|task| task.port)
                .unwrap_or(self.repository.port()?),
            endpoint: task.map(|task| format!("http://127.0.0.1:{}/mcp", task.port)),
            credentials: self.repository.list()?,
        })
    }

    pub(crate) fn configure(&self, port: u16) -> AppResult<()> {
        let state = self.state.lock();
        if state
            .task
            .as_ref()
            .is_some_and(|task| !*task.done.done.lock())
        {
            return Err(AppError::custom(CustomErrorCode::McpBusy));
        }
        self.repository.set_port(port)
    }

    pub(crate) fn authenticate(&self, token_digest: &str) -> AppResult<Caller> {
        let mut state = self.state.lock();
        if !state
            .task
            .as_ref()
            .is_some_and(|task| !task.cancel.is_cancelled() && !*task.done.done.lock())
        {
            return Err(AppError::custom(CustomErrorCode::McpUnauthorized));
        }
        let credential = self.repository.authenticate(token_digest)?;
        if state.retiring.contains(&credential.id) {
            return Err(AppError::custom(CustomErrorCode::McpUnauthorized));
        }
        let authorization = state
            .authorizations
            .entry(credential.id.clone())
            .or_default()
            .clone();
        Ok(Caller::authenticated(
            credential.id,
            credential.grants,
            authorization,
        ))
    }

    fn validate(&self, input: &McpCredentialInput) -> AppResult<()> {
        if input.name.trim().is_empty()
            || input.name.chars().count() > 80
            || input.grants.is_empty()
        {
            return Err(invalid());
        }
        let catalog = self.runtime()?.registry.catalog();
        for (module, grant) in &input.grants {
            if (module == ALL_MODULES && input.grants.len() != 1)
                || (module != ALL_MODULES && !catalog.iter().any(|entry| &entry.id == module))
                || !grant.read
                || (grant.delete && !grant.write)
            {
                return Err(invalid());
            }
        }
        Ok(())
    }

    pub(crate) fn issue(&self, input: McpCredentialInput) -> AppResult<McpIssuedCredential> {
        self.validate(&input)?;
        let _state = self.state.lock();
        self.repository.issue(input, None)
    }

    fn retire<T>(
        &self,
        id: &str,
        operation: impl FnOnce(&Repository) -> AppResult<T>,
    ) -> AppResult<T> {
        let (result, authorization) = {
            let mut state = self.state.lock();
            if state.retiring.contains(id) {
                return Err(AppError::custom(CustomErrorCode::McpBusy));
            }
            let result = operation(&self.repository)?;
            state.retiring.insert(id.into());
            let authorization = state.authorizations.remove(id);
            if let Some(authorization) = &authorization {
                authorization.disable();
            }
            (result, authorization)
        };
        if let Some(authorization) = authorization {
            authorization.drain();
        }
        self.runtime()?.registry.close_subject(id)?;
        self.state.lock().retiring.remove(id);
        Ok(result)
    }

    pub(crate) fn rotate(
        &self,
        id: &str,
        input: McpCredentialInput,
    ) -> AppResult<McpIssuedCredential> {
        self.validate(&input)?;
        self.retire(id, |repository| repository.issue(input, Some(id)))
    }

    pub(crate) fn update(&self, id: &str, input: McpCredentialInput) -> AppResult<()> {
        self.validate(&input)?;
        self.retire(id, |repository| repository.update(id, input))
    }

    pub(crate) fn revoke(&self, id: &str) -> AppResult<()> {
        self.retire(id, |repository| repository.delete(id))
    }

    pub(crate) async fn start(self: &Arc<Self>) -> AppResult<()> {
        let server = self.clone();
        let (listener, cancel, done) = self
            .executor
            .blocking_unlogged(move || {
                let mut state = server.state.lock();
                if state
                    .task
                    .as_ref()
                    .is_some_and(|task| !*task.done.done.lock())
                {
                    return Err(AppError::custom(CustomErrorCode::McpBusy));
                }
                let port = server.repository.port()?;
                let listener = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port))
                    .map_err(|error| {
                    AppError::custom(CustomErrorCode::McpTransport).context(error)
                })?;
                listener.set_nonblocking(true)?;
                server.runtime()?.registry.reopen()?;
                let cancel = CancellationToken::new();
                let done = Arc::new(Completion::default());
                state.authorizations.clear();
                state.retiring.clear();
                state.task = Some(Task {
                    port,
                    cancel: cancel.clone(),
                    done: done.clone(),
                });
                Ok((listener, cancel, Finished(done)))
            })
            .await?;
        let server = self.clone();
        let finished = done;
        tauri::async_runtime::spawn(async move {
            let _finished = finished;
            let listener = match tokio::net::TcpListener::from_std(listener) {
                Ok(listener) => listener,
                Err(error) => {
                    cancel.cancel();
                    server.record_failure(&error);
                    return;
                }
            };
            let port = match listener.local_addr() {
                Ok(address) => address.port(),
                Err(error) => {
                    cancel.cancel();
                    server.record_failure(&error);
                    return;
                }
            };
            let router = transport::router(server.clone(), cancel.clone(), port);
            let listener = super::listener::Listener::new(listener, server.diagnostics.clone());
            let serve = axum::serve(listener, router)
                .with_graceful_shutdown(cancel.clone().cancelled_owned())
                .into_future();
            tokio::pin!(serve);
            let mut expiry = tokio::time::interval(Duration::from_secs(30));
            loop {
                tokio::select! {
                    result = &mut serve => {
                        if let Err(error) = result { server.record_failure(&error); }
                        break;
                    }
                    _ = expiry.tick(), if !cancel.is_cancelled() => {
                        let runtime = server.runtime();
                        if let Ok(runtime) = runtime {
                            let _ = run_blocking(move || runtime.registry.busy().map(|_|())).await;
                        }
                    }
                }
            }
            cancel.cancel();
            let cleanup = server.clone();
            if let Err(error) = run_blocking(move || cleanup.drain()).await {
                server.record_failure(&error);
            }
        });
        Ok(())
    }

    fn record_failure(&self, error: &dyn std::fmt::Display) {
        if let Some(mut recorder) = self.diagnostics.begin("mcp", "server", "127.0.0.1") {
            recorder.transport_error(error);
            recorder.finish(Some(&AppError::custom(CustomErrorCode::McpTransport)));
        }
    }

    fn drain(&self) -> AppResult<()> {
        let authorizations = {
            let mut state = self.state.lock();
            for authorization in state.authorizations.values() {
                authorization.disable();
            }
            std::mem::take(&mut state.authorizations)
        };
        for authorization in authorizations.values() {
            authorization.drain();
        }
        self.runtime()?.registry.shutdown()
    }

    pub(crate) fn stop_blocking(&self) {
        let done = {
            let state = self.state.lock();
            if let Some(task) = &state.task {
                task.cancel.cancel();
                for authorization in state.authorizations.values() {
                    authorization.disable();
                }
                Some(task.done.clone())
            } else {
                None
            }
        };
        if let Some(done) = done {
            let mut finished = done.done.lock();
            while !*finished {
                done.changed.wait(&mut finished);
            }
        }
    }
}
