use std::sync::{Arc, OnceLock};

use super::registry::Registry;
use super::server::Server;
use crate::error::AppResult;
use crate::{
    core::{diagnostics::Diagnostics, execution::Executor},
    storage::Storage,
};

pub(crate) struct McpRuntime {
    pub(crate) registry: Registry,
    server: OnceLock<Arc<Server>>,
}

impl McpRuntime {
    pub(crate) fn new(registry: Registry) -> Arc<Self> {
        Arc::new(Self {
            registry,
            server: OnceLock::new(),
        })
    }

    pub(crate) fn attach(
        self: &Arc<Self>,
        storage: Storage,
        diagnostics: Arc<Diagnostics>,
        executor: Executor,
    ) -> AppResult<()> {
        self.server
            .set(Server::new(
                Arc::downgrade(self),
                storage,
                diagnostics,
                executor,
            ))
            .map_err(|_| super::repository::invalid())
    }

    pub(crate) fn server(&self) -> AppResult<&Arc<Server>> {
        self.server.get().ok_or_else(super::repository::invalid)
    }

    pub(crate) fn shutdown(&self) {
        if let Some(server) = self.server.get() {
            server.stop_blocking();
        }
        if let Err(error) = self.registry.shutdown() {
            crate::runtime_log!("MCP draft cleanup failed: {}", error.code);
        }
    }

    pub(crate) fn busy(&self) -> AppResult<bool> {
        if self.server.get().is_some_and(|server| server.is_busy()) {
            return Ok(true);
        }
        self.registry.busy()
    }
}
