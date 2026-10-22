use std::sync::Arc;

use rmcp::{
    model::{
        CallToolRequestParams, CallToolResponse, Implementation, ListToolsResult,
        PaginatedRequestParams, ServerCapabilities, ServerConfig, Tool,
    },
    service::RequestContext,
    ErrorData, RoleServer, ServerHandler,
};
use serde_json::Value;

use super::transport_body::SharedLog;
use super::{access::Caller, runtime::McpRuntime};
use crate::error::AppResult;

pub(crate) struct Handler {
    runtime: Arc<McpRuntime>,
    caller: Arc<dyn Fn() -> AppResult<Caller> + Send + Sync>,
    log: SharedLog,
}

impl Handler {
    pub(crate) fn new(
        runtime: Arc<McpRuntime>,
        caller: impl Fn() -> AppResult<Caller> + Send + Sync + 'static,
    ) -> Self {
        Self {
            runtime,
            caller: Arc::new(caller),
            log: None,
        }
    }

    pub(crate) fn with_log(mut self, log: SharedLog) -> Self {
        self.log = log;
        self
    }

    fn authorized_caller(&self) -> Result<Caller, ErrorData> {
        (self.caller)()
            .map_err(|_| ErrorData::invalid_params("MCP authorization is unavailable", None))
    }
}

impl ServerHandler for Handler {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new("mftp", env!("CARGO_PKG_VERSION")))
    }

    async fn list_tools(
        &self,
        request: Option<PaginatedRequestParams>,
        _: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        if request.is_some_and(|request| request.cursor.is_some()) {
            return Err(ErrorData::invalid_params(
                "Tool catalog does not use pagination",
                None,
            ));
        }
        Ok(ListToolsResult::with_all_items(
            self.runtime.registry.list(&self.authorized_caller()?),
        ))
    }

    fn get_tool(&self, name: &str) -> Option<Tool> {
        let caller = self.authorized_caller().ok()?;
        self.runtime
            .registry
            .list(&caller)
            .into_iter()
            .find(|tool| tool.name == name)
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        let result = self
            .runtime
            .registry
            .call(
                self.authorized_caller()?,
                &request.name,
                Value::Object(request.arguments.unwrap_or_default()),
            )
            .await
            .map(Into::into);
        if let (Ok(CallToolResponse::Complete(response)), Some(mut log)) =
            (&result, self.log.as_ref().and_then(|log| log.try_lock()))
        {
            if let Some(error) = response
                .structured_content
                .as_ref()
                .and_then(|content| content.get("error"))
                .and_then(|error| serde_json::from_value(error.clone()).ok())
            {
                log.error = Some(error);
            }
        }
        result
    }
}
